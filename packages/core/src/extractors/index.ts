/**
 * TokenWise Extractors — orchestrates parsing → graph analysis →
 * strategy selection → ranking → serialization into the final
 * optimized context.
 *
 * This is the top-level pipeline that all entry points feed through.
 */

import type {
  Symbol,
  OptimizationOptions,
  OptimizationResult,
  CodeChunk,
  Language,
  TokenEncoding,
  Model,
  ExtractionStrategy,
  TaskType,
} from '../types.js';
import { DEFAULT_ENCODING } from '../types.js';
import { parseCode, parseCodeSync, detectLanguage } from '../parser/index.js';
import { Tokenizer } from '../tokenizer/index.js';
import { buildGraph, getGraphStats } from '../graph/index.js';
import {
  selectStrategy,
  rankSymbols,
  applyStrategySelection,
} from '../strategies/index.js';
import { compress } from '../compressors/index.js';

// ────────────────────────────────────────────────────────────
// PIPELINE: optimizeContext
// ────────────────────────────────────────────────────────────

/**
 * Main optimization entry point.
 *
 * Pipeline steps:
 *   1. Detect language & encoding
 *   2. Parse code (tree-sitter → regex fallback)
 *   3. Build dependency graph & calculate importance
 *   4. Select strategy (auto if 'adaptive')
 *   5. Rank symbols by importance + task relevance
 *   6. Apply strategy to select/filter symbols
 *   7. Serialize into compressed context
 *   8. Calculate metrics
 */
export async function optimizeContext(
  code: string,
  options: Partial<OptimizationOptions> = {},
): Promise<OptimizationResult> {
  const startTime = performance.now();

  // ── 1. Defaults & setup ──
  const opts = resolveOptions(code, options);
  const encoding = opts.encoding ?? DEFAULT_ENCODING;
  const tokenizer = new Tokenizer({ encoding });
  const originalTokens = tokenizer.count(code);

  // ── 2. Parse ──
  const parseResult = await parseCode(code, opts.language!, {
    language: opts.language!,
    includeComments: false,
    includeDocstrings: true,
    maxFileSizeBytes: code.length,
    parseTimeoutMs: opts.maxProcessingTimeMs,
  });
  const symbols = parseResult.symbols;

  // ── 3. Build call graph ──
  const graph = buildGraph(symbols, {
    maxDepth: opts.callGraphDepth ?? 2,
    entryPoints: opts.relevantSymbols,
    includeImports: true,
    includeInheritance: true,
  });

  // Extract PageRank scores for ranking
  const pageRanks = new Map<string, number>();
  for (const [id, node] of graph.nodes) {
    pageRanks.set(id, node.pageRank);
  }

  const graphStats = getGraphStats(graph);

  // ── 4. Determine token budget ──
  const modelLimits = getModelTokenLimit(opts.model!, opts.maxTokens, opts.targetTokens);
  const totalBudget = modelLimits.targetTokens;

  // ── 5. Select strategy ──
  const strategy = selectStrategy(
    opts.strategy!,
    opts.model!,
    opts.taskType,
    totalBudget,
    code.length,
    opts.language!,
  );

  // ── 6. Rank symbols ──
  const ranked = rankSymbols(symbols, strategy, opts.taskPrompt, pageRanks);

  // ── 7. Apply strategy selection ──
  const { included, excluded } = applyStrategySelection(ranked, strategy, totalBudget);
  const includedNames = included.map(s => s.name);
  const excludedNames = excluded.map(s => s.name);

  // ── 8. Serialize ──
  const { code: serialized, chunks } = serializeSymbols(included, {
    includeImports: opts.includeImports,
    includeDocumentation: opts.includeDocumentation,
    taskType: opts.taskType,
    language: opts.language,
    strategy: opts.strategy!,
    minify: strategy.minifyEnabled,
    encoding,
  });

  // ── 9. Apply compression ──
  let finalCode = serialized;
  if (strategy.minifyEnabled) {
    finalCode = compress(finalCode, {
      removeComments: true,
      removeBlankLines: true,
      collapseWhitespace: true,
      minify: true,
      preserveShebang: true,
      preserveLicense: true,
      preserveImportantComments: true,
    }, opts.language);
  }

  const optimizedTokens = tokenizer.count(finalCode);
  const elapsed = Math.round(performance.now() - startTime);

  // ── 10. Result ──
  return {
    code: finalCode,
    chunks,
    originalTokens,
    optimizedTokens,
    reductionTokens: originalTokens - optimizedTokens,
    reductionPercent: originalTokens > 0
      ? Math.round((1 - optimizedTokens / originalTokens) * 100)
      : 0,
    compressionRatio: optimizedTokens > 0
      ? Math.round((originalTokens / optimizedTokens) * 100) / 100
      : 1,
    strategy: opts.strategy!,
    model: opts.model!,
    encoding,
    processingTimeMs: elapsed,
    taskType: opts.taskType!,
    includedSymbols: includedNames,
    excludedSymbols: excludedNames,
    totalSymbolsFound: symbols.length,
    language: opts.language!,
    estimatedCompleteness: includedNames.length > 0
      ? Math.round((includedNames.length / Math.max(1, symbols.length)) * 100)
      : 0,
    semanticCoverage: ranked.length > 0
      ? Math.round((included.reduce((s, sym) => s + sym.rank, 0) / ranked.reduce((s, sym) => s + sym.rank, 0)) * 100)
      : 0,
    callGraphStats: graphStats.totalNodes > 0 ? {
      totalNodes: graphStats.totalNodes,
      totalEdges: graphStats.totalEdges,
      maxDepth: strategy.maxGraphDepth,
      clusters: graphStats.clusters,
    } : undefined,
  };
}

// ────────────────────────────────────────────────────────────
// SYNCHRONOUS VARIANT (no tree-sitter)
// ────────────────────────────────────────────────────────────

export function optimizeContextSync(
  code: string,
  options: Partial<OptimizationOptions> = {},
): OptimizationResult {
  const startTime = performance.now();
  const opts = resolveOptions(code, options);
  const encoding = opts.encoding ?? DEFAULT_ENCODING;
  const tokenizer = new Tokenizer({ encoding });
  const originalTokens = tokenizer.count(code);

  // Early return for empty input
  if (!code || code.trim().length === 0) {
    return {
      code: '', chunks: [],
      originalTokens: 0, optimizedTokens: 0, reductionTokens: 0, reductionPercent: 0, compressionRatio: 1,
      strategy: opts.strategy!, model: opts.model!, encoding,
      processingTimeMs: Math.round(performance.now() - startTime),
      taskType: 'general', includedSymbols: [], excludedSymbols: [], totalSymbolsFound: 0,
      language: opts.language!, estimatedCompleteness: 100, semanticCoverage: 100,
    };
  }

  const symbols = parseCodeSync(code, opts.language!);

  const totalBudget = getModelTokenLimit(opts.model!, opts.maxTokens, opts.targetTokens).targetTokens;
  const strategy = selectStrategy(
    opts.strategy!,
    opts.model!,
    opts.taskType,
    totalBudget,
    code.length,
    opts.language!,
  );
  const ranked = rankSymbols(symbols, strategy, opts.taskPrompt);
  const { included, excluded } = applyStrategySelection(ranked, strategy, totalBudget);

  const { code: serialized } = serializeSymbols(included, {
    includeImports: opts.includeImports,
    includeDocumentation: opts.includeDocumentation,
    taskType: opts.taskType,
    language: opts.language,
    strategy: opts.strategy!,
    minify: strategy.minifyEnabled,
    encoding,
  });

  const optimizedTokens = tokenizer.count(serialized);
  const elapsed = Math.round(performance.now() - startTime);

  return {
    code: serialized,
    chunks: [],
    originalTokens,
    optimizedTokens,
    reductionTokens: originalTokens - optimizedTokens,
    reductionPercent: originalTokens > 0 ? Math.round((1 - optimizedTokens / originalTokens) * 100) : 0,
    compressionRatio: optimizedTokens > 0 ? Math.round((originalTokens / optimizedTokens) * 100) / 100 : 1,
    strategy: opts.strategy!,
    model: opts.model!,
    encoding,
    processingTimeMs: elapsed,
    taskType: opts.taskType!,
    includedSymbols: included.map(s => s.name),
    excludedSymbols: excluded.map(s => s.name),
    totalSymbolsFound: symbols.length,
    language: opts.language!,
    estimatedCompleteness: included.length > 0 ? Math.round((included.length / Math.max(1, symbols.length)) * 100) : 0,
    semanticCoverage: ranked.length > 0 ? Math.round((included.reduce((s, sym) => s + sym.rank, 0) / ranked.reduce((s, sym) => s + sym.rank, 0)) * 100) : 0,
  };
}

// ────────────────────────────────────────────────────────────
// COMPRESS-ONLY MODE
// ────────────────────────────────────────────────────────────

export function compressContext(
  code: string,
  options: Partial<OptimizationOptions> = {},
): OptimizationResult {
  const startTime = performance.now();
  const opts = resolveOptions(code, options);
  const encoding = opts.encoding ?? DEFAULT_ENCODING;
  const tokenizer = new Tokenizer({ encoding });
  const originalTokens = tokenizer.count(code);

  const compressed = compress(code, {
    removeComments: true,
    removeBlankLines: true,
    collapseWhitespace: true,
  }, opts.language);

  const optimizedTokens = tokenizer.count(compressed);
  const elapsed = Math.round(performance.now() - startTime);

  return {
    code: compressed,
    chunks: [],
    originalTokens,
    optimizedTokens,
    reductionTokens: originalTokens - optimizedTokens,
    reductionPercent: originalTokens > 0 ? Math.round((1 - optimizedTokens / originalTokens) * 100) : 0,
    compressionRatio: optimizedTokens > 0 ? Math.round((originalTokens / optimizedTokens) * 100) / 100 : 1,
    strategy: 'balanced',
    model: opts.model!,
    encoding,
    processingTimeMs: elapsed,
    taskType: 'general',
    includedSymbols: [],
    excludedSymbols: [],
    totalSymbolsFound: 0,
    language: opts.language!,
    estimatedCompleteness: 100,
    semanticCoverage: 100,
  };
}

// ────────────────────────────────────────────────────────────
// DIFF MODE
// ────────────────────────────────────────────────────────────

export function extractDiff(
  original: string,
  modified: string,
  options: Partial<OptimizationOptions> = {},
): OptimizationResult {
  const startTime = performance.now();
  const opts = resolveOptions(modified, options);

  const origSymbols = parseCodeSync(original, opts.language!);
  const modSymbols = parseCodeSync(modified, opts.language!);

  const origMap = new Map(origSymbols.map(s => [s.name, s]));
  const changed: Symbol[] = [];

  for (const sym of modSymbols) {
    const orig = origMap.get(sym.name);
    if (!orig || orig.fullSource !== sym.fullSource) {
      changed.push(sym);
    }
  }

  const encoding = opts.encoding ?? DEFAULT_ENCODING;
  const tokenizer = new Tokenizer({ encoding });
  // In diff mode, "original" is the full modified file — we measure how much
  // we saved by sending only the changed symbols instead of the whole file.
  const originalTokens = tokenizer.count(modified);

  // In diff mode, all changed symbols keep their full body
  const diffSymbols = changed.map(s => ({ ...s, shouldKeepBody: true }));
  const { code: serialized } = serializeSymbols(diffSymbols, {
    includeImports: true,
    includeDocumentation: false,
    taskType: opts.taskType,
    language: opts.language,
    strategy: opts.strategy ?? 'semantic',
    minify: false,
    encoding,
  });

  const optimizedTokens = tokenizer.count(serialized);
  const elapsed = Math.round(performance.now() - startTime);

  return {
    code: serialized,
    chunks: [],
    originalTokens,
    optimizedTokens,
    reductionTokens: originalTokens - optimizedTokens,
    reductionPercent: originalTokens > 0 ? Math.round((1 - optimizedTokens / originalTokens) * 100) : 0,
    compressionRatio: optimizedTokens > 0 ? Math.round((originalTokens / optimizedTokens) * 100) / 100 : 1,
    strategy: 'semantic',
    model: opts.model!,
    encoding,
    processingTimeMs: elapsed,
    taskType: 'code-review',
    includedSymbols: changed.map(s => s.name),
    excludedSymbols: origSymbols.filter(s => !changed.find(c => c.name === s.name)).map(s => s.name),
    totalSymbolsFound: modSymbols.length,
    language: opts.language!,
    estimatedCompleteness: 100,
    semanticCoverage: 100,
  };
}

// ────────────────────────────────────────────────────────────
// MULTI-FILE OPTIMIZATION
// ────────────────────────────────────────────────────────────

export async function optimizeMultiFile(
  files: Array<{ path: string; code: string }>,
  options: Partial<OptimizationOptions> = {},
): Promise<OptimizationResult[]> {
  const results: OptimizationResult[] = [];
  for (const file of files) {
    const lang = detectLanguage(file.path);
    const result = await optimizeContext(file.code, { ...options, language: lang });
    results.push({ ...result, filePath: file.path });
  }
  return results;
}

export function optimizeMultiFileSync(
  files: Array<{ path: string; code: string }>,
  options: Partial<OptimizationOptions> = {},
): OptimizationResult[] {
  return files.map(file => {
    const lang = detectLanguage(file.path);
    const result = optimizeContextSync(file.code, { ...options, language: lang });
    return { ...result, filePath: file.path };
  });
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

interface ResolvedOptions {
  language: Language;
  encoding: TokenEncoding;
  model: Model;
  strategy: ExtractionStrategy;
  taskType: TaskType;
  includeImports: boolean;
  includeDocumentation: boolean;
  maxTokens?: number;
  targetTokens?: number;
  maxProcessingTimeMs?: number;
  callGraphDepth?: number;
  taskPrompt?: string;
  relevantSymbols?: string[];
}

function resolveOptions(_code: string, options: Partial<OptimizationOptions>): ResolvedOptions {
  return {
    language: options.language ?? detectLanguage(options.focusFiles?.[0] ?? ''),
    encoding: options.encoding ?? DEFAULT_ENCODING,
    model: options.model ?? 'claude-3-sonnet',
    strategy: options.strategy ?? 'adaptive',
    taskType: options.taskType ?? 'general',
    includeImports: options.includeImports ?? true,
    includeDocumentation: options.includeDocumentation ?? false,
    maxTokens: options.maxTokens,
    targetTokens: options.targetTokens,
    maxProcessingTimeMs: options.maxProcessingTimeMs ?? 5_000,
    callGraphDepth: options.callGraphDepth ?? 2,
    taskPrompt: options.taskPrompt,
    relevantSymbols: options.relevantSymbols,
  };
}

function getModelTokenLimit(model: Model, maxTokens?: number, targetTokens?: number): { maxTokens: number; targetTokens: number } {
  if (maxTokens && targetTokens) return { maxTokens, targetTokens };

  const MODEL_LIMITS: Record<string, { max: number; recommended: number }> = {
    'claude-3-opus':   { max: 200_000, recommended: 180_000 },
    'claude-3-sonnet': { max: 200_000, recommended: 150_000 },
    'claude-3-haiku':  { max: 200_000, recommended: 150_000 },
    'claude-opus-4':   { max: 200_000, recommended: 180_000 },
    'claude-sonnet-4': { max: 200_000, recommended: 150_000 },
    'claude-haiku-4':  { max: 200_000, recommended: 150_000 },
    'gpt-4-turbo':     { max: 128_000, recommended: 100_000 },
    'gpt-4':           { max: 8_192, recommended: 6_000 },
    'gpt-3.5-turbo':   { max: 16_385, recommended: 12_000 },
    'gemini-pro':      { max: 30_720, recommended: 25_000 },
    'local':           { max: 8_192, recommended: 4_000 },
  };

  const limits = MODEL_LIMITS[model] ?? MODEL_LIMITS['claude-3-sonnet'];
  return {
    maxTokens: maxTokens ?? limits.max,
    targetTokens: targetTokens ?? limits.recommended,
  };
}

function serializeSymbols(
  symbols: Array<{ name: string; signature: string; fullSource: string; shouldKeepBody?: boolean; documentation?: string; type?: string; importStatements?: string[] }>,
  opts: {
    includeImports?: boolean;
    includeDocumentation?: boolean;
    taskType?: TaskType;
    language?: string;
    strategy?: string;
    minify?: boolean;
    encoding?: string;
  },
): { code: string; chunks: CodeChunk[] } {
  const lines: string[] = [];
  const chunks: CodeChunk[] = [];
  let lineNum = 1;

  // Header with metadata (only if we have symbols)
  if (opts.strategy && !opts.minify && symbols.length > 0) {
    lines.push(`// Optimized for ${opts.taskType ?? 'general'} task · ${opts.strategy} strategy`);
    lineNum++;
  }

  // Collect unique imports
  const seenImports = new Set<string>();
  let importBlock = '';
  if (opts.includeImports) {
    for (const sym of symbols) {
      for (const imp of sym.importStatements ?? []) {
        if (!seenImports.has(imp)) {
          seenImports.add(imp);
          importBlock += imp + '\n';
          lineNum++;
        }
      }
    }
    if (importBlock) {
      importBlock += '\n';
      lineNum++;
    }
  }

  // Serialize each symbol
  for (const sym of symbols) {
    const content = sym.shouldKeepBody ? sym.fullSource : sym.signature;
    if (!content) continue;

    const symLines = content.split('\n');
    const startLine = lineNum;

    // Add documentation if requested
    if (opts.includeDocumentation && sym.documentation) {
      lines.push(`/** ${sym.documentation} */`);
      lineNum++;
    }

    // Add the symbol
    if (opts.minify) {
      // Compact format: symbol on one line
      lines.push(`// ${sym.name}: ${sym.type ?? 'symbol'}`);
      lines.push(content.replace(/\n+/g, ' ').trim());
      lineNum += 2;
    } else {
      lines.push(content);
      lineNum += symLines.length;
    }

    // Separator
    if (!opts.minify) {
      lines.push('');
      lineNum++;
    }

    chunks.push({
      content,
      startLine,
      endLine: lineNum - 1,
      tokenCount: Math.max(1, Math.ceil(content.length / 3.5)),
      symbols: [sym.name],
      priority: sym.shouldKeepBody ? 10 : 5,
      chunkType: 'symbol',
    });
  }

  const code = (importBlock || '') + lines.join('\n');

  return {
    code: code.trim(),
    chunks,
  };
}
