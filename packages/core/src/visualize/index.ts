/**
 * TokenWise Budget Visualizer — shows where tokens went in an optimization
 *
 * Provides structured breakdowns, ASCII bar charts, and JSON output
 * for analyzing token allocation across code categories.
 */

import type {
  OptimizationResult,
  CodeChunk,
  Language,
  TokenEncoding,
} from '../types.js';
import { Tokenizer } from '../tokenizer/index.js';
import { parseCodeSync } from '../parser/index.js';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

/**
 * Token budget breakdown by category.
 */
export interface BudgetBreakdown {
  /** Total tokens in the optimized output */
  total: number;
  /** Header/metadata tokens (task type, strategy info) */
  header: number;
  /** Import statement tokens */
  imports: number;
  /** Symbol tokens (function/class/interface bodies & signatures) */
  symbols: number;
  /** Dependency context tokens (type refs, used symbols) */
  dependencies: number;
  /** Overhead: whitespace, separators, formatting */
  overhead: number;
  /** Per-symbol token breakdown */
  perSymbol: PerSymbolBreakdown[];
  /** Overall reduction percentage */
  reduction: number;
}

/**
 * Per-symbol token usage.
 */
export interface PerSymbolBreakdown {
  /** Symbol name */
  name: string;
  /** Symbol type (function, class, interface, etc.) */
  type: string;
  /** Tokens used by this symbol */
  tokens: number;
  /** Percentage of total symbol tokens */
  pct: number;
  /** Whether full body was kept */
  hasBody: boolean;
}

/**
 * Estimated savings from optimization.
 */
export interface SavingsEstimate {
  /** Original token count */
  originalTokens: number;
  /** Average characters per token */
  charsPerToken: number;
  /** Estimated optimized token count */
  estimatedOptimizedTokens: number;
  /** Estimated savings percentage */
  savingsPercent: number;
}

// ════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Categorize a chunk by its type.
 */
type BudgetCategory = 'header' | 'imports' | 'symbols' | 'dependencies' | 'overhead';

function categorizeChunk(chunk: CodeChunk): BudgetCategory {
  switch (chunk.chunkType) {
    case 'header':
      return 'header';
    case 'import':
      return 'imports';
    case 'symbol':
      return 'symbols';
    case 'dependency':
      return 'dependencies';
    case 'context':
    case 'footer':
    default:
      return 'overhead';
  }
}

/**
 * Get symbol type from chunk content (heuristic).
 */
function inferSymbolType(content: string): string {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('class ')) return 'class';
  if (trimmed.startsWith('interface ')) return 'interface';
  if (trimmed.startsWith('type ')) return 'typeAlias';
  if (trimmed.startsWith('enum ')) return 'enum';
  if (trimmed.startsWith('function ') || trimmed.startsWith('async function ')) return 'function';
  if (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) {
    // Check if it's an arrow function
    if (trimmed.includes('=>')) return 'arrowFunction';
    return 'variable';
  }
  if (trimmed.includes('()') && trimmed.includes('{')) return 'method';
  return 'symbol';
}

/**
 * Check if a symbol chunk has its full body (not just signature).
 */
function hasBody(chunk: CodeChunk): boolean {
  // If token count is significantly larger than a signature would be
  const name = chunk.symbols[0] ?? '';
  const signatureTokens = name ? Math.ceil(name.length / 3.5) : 20;
  return chunk.tokenCount > signatureTokens * 2;
}

/**
 * Format a number with commas (e.g., 1234 -> "1,234").
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Create an ASCII bar chart.
 */
function createBar(pct: number, maxWidth = 20): string {
  const filled = Math.round((pct / 100) * maxWidth);
  const empty = maxWidth - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════

/**
 * Visualize token budget from an optimization result.
 *
 * Breaks down the optimized output into categories (header, imports, symbols,
 * dependencies, overhead) and provides per-symbol details.
 *
 * @param result OptimizationResult from optimizeContext or optimizeContextSync
 * @returns Structured BudgetBreakdown with category totals and per-symbol data
 *
 * @example
 * ```ts
 * const result = optimizeContextSync(code, { strategy: 'balanced' });
 * const breakdown = visualizeBudget(result);
 * console.log(`Symbols: ${breakdown.symbols} tokens (${breakdown.perSymbol.length} symbols)`);
 * ```
 */
export function visualizeBudget(result: OptimizationResult): BudgetBreakdown {
  if (!result || result.optimizedTokens === 0) {
    return {
      total: 0,
      header: 0,
      imports: 0,
      symbols: 0,
      dependencies: 0,
      overhead: 0,
      perSymbol: [],
      reduction: result?.reductionPercent ?? 0,
    };
  }

  const breakdown: BudgetBreakdown = {
    total: result.optimizedTokens,
    header: 0,
    imports: 0,
    symbols: 0,
    dependencies: 0,
    overhead: 0,
    perSymbol: [],
    reduction: result.reductionPercent,
  };

  // Accumulate tokens by category from chunks
  const categoryTotals: Record<BudgetCategory, number> = { header: 0, imports: 0, symbols: 0, dependencies: 0, overhead: 0 };
  for (const chunk of result.chunks) {
    const category = categorizeChunk(chunk);
    categoryTotals[category] += chunk.tokenCount;

    // Per-symbol breakdown for symbol chunks
    if (chunk.chunkType === 'symbol' && chunk.symbols.length > 0) {
      const symName = chunk.symbols[0];
      breakdown.perSymbol.push({
        name: symName,
        type: inferSymbolType(chunk.content),
        tokens: chunk.tokenCount,
        pct: 0, // will calculate after loop
        hasBody: hasBody(chunk),
      });
    }
  }

  // Apply category totals to the breakdown
  breakdown.header = categoryTotals.header;
  breakdown.imports = categoryTotals.imports;
  breakdown.symbols = categoryTotals.symbols;
  breakdown.dependencies = categoryTotals.dependencies;
  breakdown.overhead = categoryTotals.overhead;

  // Calculate percentages for per-symbol breakdown
  const totalSymbolTokens = breakdown.symbols;
  if (totalSymbolTokens > 0) {
    for (const sym of breakdown.perSymbol) {
      sym.pct = Math.round((sym.tokens / totalSymbolTokens) * 1000) / 10; // 1 decimal
    }
    // Sort by tokens descending
    breakdown.perSymbol.sort((a, b) => b.tokens - a.tokens);
  }

  return breakdown;
}

/**
 * Format budget as ASCII bar chart text.
 *
 * @param result OptimizationResult from optimizeContext or optimizeContextSync
 * @returns Multi-line string with ASCII bars and token counts
 *
 * @example
 * ```ts
 * const result = optimizeContextSync(code);
 * console.log(formatBudgetText(result));
 * // symbols   ████████████ 78.4% (1,203 tok)
 * // imports   ████ 15.2% (233 tok)
 * // overhead  ██ 6.4% (98 tok)
 * ```
 */
export function formatBudgetText(result: OptimizationResult): string {
  const breakdown = visualizeBudget(result);
  const lines: string[] = [];

  if (breakdown.total === 0) {
    return 'No tokens to visualize (empty result)';
  }

  const categories: Array<{ key: keyof Omit<BudgetBreakdown, 'total' | 'perSymbol' | 'reduction'>; label: string }> = [
    { key: 'symbols', label: 'symbols' },
    { key: 'imports', label: 'imports' },
    { key: 'header', label: 'header' },
    { key: 'dependencies', label: 'dependencies' },
    { key: 'overhead', label: 'overhead' },
  ];

  for (const { key, label } of categories) {
    const tokens = breakdown[key];
    const pct = breakdown.total > 0 ? (tokens / breakdown.total) * 100 : 0;
    const bar = createBar(pct);
    lines.push(
      `${label.padEnd(12)} ${bar} ${pct.toFixed(1).padStart(5)}% (${formatNumber(tokens).padStart(6)} tok)`
    );
  }

  lines.push('');
  lines.push(`total        ${formatNumber(breakdown.total).padStart(6)} tokens`);
  lines.push(`reduction    ${breakdown.reduction.toFixed(1)}%`);

  // Top symbols detail
  if (breakdown.perSymbol.length > 0) {
    lines.push('');
    lines.push('Top symbols by tokens:');
    for (const sym of breakdown.perSymbol.slice(0, 10)) {
      const bodyMarker = sym.hasBody ? ' ●' : ' ○';
      lines.push(
        `  ${sym.name.padEnd(24)} ${formatNumber(sym.tokens).padStart(6)} tok (${sym.pct.toFixed(1)}%)${bodyMarker}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Format budget as JSON string.
 *
 * @param result OptimizationResult from optimizeContext or optimizeContextSync
 * @returns JSON string of the BudgetBreakdown (pretty-printed)
 */
export function formatBudgetJSON(result: OptimizationResult): string {
  const breakdown = visualizeBudget(result);
  return JSON.stringify(breakdown, null, 2);
}

/**
 * Estimate potential savings from optimization without running it.
 *
 * Parses the code, counts tokens, and estimates what an aggressive
 * optimization would produce based on typical compression ratios.
 *
 * @param code Source code to analyze
 * @param language Programming language (default: 'typescript')
 * @param encoding Token encoding (default: 'cl100k_base')
 * @returns SavingsEstimate with original/optimized tokens and savings %
 *
 * @example
 * ```ts
 * const estimate = estimateSavings(code, 'typescript');
 * console.log(`Estimated savings: ${estimate.savingsPercent.toFixed(1)}%`);
 * // Estimated savings: 72.3%
 * ```
 */
export function estimateSavings(
  code: string,
  language: Language = 'typescript',
  encoding: TokenEncoding = 'cl100k_base'
): SavingsEstimate {
  if (!code || code.trim().length === 0) {
    return {
      originalTokens: 0,
      charsPerToken: 0,
      estimatedOptimizedTokens: 0,
      savingsPercent: 0,
    };
  }

  const tokenizer = new Tokenizer({ encoding });
  const originalTokens = tokenizer.count(code);
  const charsPerToken = code.length / originalTokens;

  // Parse to find symbols
  const symbols = parseCodeSync(code, language);
  const symbolCount = symbols.length;

  // Estimate: header (~3%), imports (~5%), symbols compressed to signatures (~20-40% of original)
  // Aggressive strategy keeps signatures only for most symbols
  const headerTokens = Math.ceil(originalTokens * 0.03);
  const importTokens = Math.ceil(originalTokens * 0.05);

  // Estimate symbol tokens: signatures only for ~80% of symbols
  // A signature is ~15-25 tokens, full body varies
  const avgSignatureTokens = 20;
  const symbolsWithBody = Math.ceil(symbolCount * 0.2); // top 20% keep bodies
  const symbolsSignaturesOnly = symbolCount - symbolsWithBody;

  // Rough estimate: original symbol tokens * 0.25 (signatures) + top 20% full bodies
  const originalSymbolTokens = originalTokens - headerTokens - importTokens;
  const estimatedSymbolTokens =
    symbolsSignaturesOnly * avgSignatureTokens +
    Math.ceil(originalSymbolTokens * 0.2); // top 20% keep ~80% of their tokens

  const estimatedOptimizedTokens = headerTokens + importTokens + estimatedSymbolTokens;
  const savingsPercent = originalTokens > 0
    ? Math.round((1 - estimatedOptimizedTokens / originalTokens) * 1000) / 10
    : 0;

  return {
    originalTokens,
    charsPerToken: Math.round(charsPerToken * 100) / 100,
    estimatedOptimizedTokens: Math.max(1, estimatedOptimizedTokens),
    savingsPercent,
  };
}

// ════════════════════════════════════════════════════════════
// VISUALIZER CLASS
// ════════════════════════════════════════════════════════════

/**
 * Tiny helper class with static methods wrapping the visualizer functions.
 *
 * @example
 * ```ts
 * const result = optimizeContextSync(code);
 * console.log(Visualizer.text(result));
 * console.log(Visualizer.json(result));
 * const est = Visualizer.estimate(code);
 * ```
 */
export class Visualizer {
  /** Get structured budget breakdown. */
  static breakdown(result: OptimizationResult): BudgetBreakdown {
    return visualizeBudget(result);
  }

  /** Get ASCII bar chart text. */
  static text(result: OptimizationResult): string {
    return formatBudgetText(result);
  }

  /** Get JSON string. */
  static json(result: OptimizationResult): string {
    return formatBudgetJSON(result);
  }

  /** Estimate savings before running optimization. */
  static estimate(code: string, language?: Language, encoding?: TokenEncoding): SavingsEstimate {
    return estimateSavings(code, language, encoding);
  }
}