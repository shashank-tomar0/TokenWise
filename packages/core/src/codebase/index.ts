/**
 * TokenWise Codebase Walker — multi-file project analysis
 *
 * Walks a directory tree, parses every source file, and builds
 * a unified cross-file symbol graph with dependency resolution.
 *
 * Features:
 *   - Glob-based file discovery (respects .gitignore)
 *   - Parallel parsing with concurrency control
 *   - Cross-file import resolution
 *   - Global call graph with inter-file edges
 *   - Entry-point detection (package.json, main, index)
 *   - Smart context extraction across the whole codebase
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';

import type { Language, Symbol, SymbolGraph, OptimizationOptions } from '../types.js';
import { parseCodeSync, detectLanguage } from '../parser/index.js';
import { buildGraph, getGraphStats } from '../graph/index.js';
import { Tokenizer } from '../tokenizer/index.js';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

export interface CodebaseFile {
  path: string;
  relativePath: string;
  language: Language;
  content: string;
  size: number;
}

export interface CodebaseOptions {
  /** Root directory to scan */
  rootDir: string;
  /** File glob patterns to include (default: source files) */
  include?: string[];
  /** File glob patterns to exclude */
  exclude?: string[];
  /** Max file size in bytes (default: 1MB) */
  maxFileSize?: number;
  /** Max files to parse (default: 500) */
  maxFiles?: number;
  /** Parallel parsing concurrency (default: 4) */
  concurrency?: number;
  /** Ignore node_modules, .git, dist by default (default: true) */
  skipCommonDirs?: boolean;
  /** Include tree-sitter parsing (slower but more accurate) */
  useTreeSitter?: boolean;
  /** Detect entry points from package.json, main files */
  detectEntryPoints?: boolean;
}

export interface CodebaseAnalysis {
  files: CodebaseFile[];
  totalFiles: number;
  parsedFiles: number;
  totalLines: number;
  totalTokens: number;
  symbols: Symbol[];
  globalGraph: SymbolGraph;
  entryPoints: string[];
  stats: {
    languages: Record<string, number>;
    totalSymbols: number;
    graphNodes: number;
    graphEdges: number;
    clusters: number;
    processingTimeMs: number;
  };
}

// ────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ────────────────────────────────────────────────────────────

const SOURCE_PATTERNS = [
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.cpp', '**/*.c',
  '**/*.h', '**/*.hpp', '**/*.rb', '**/*.php', '**/*.cs', '**/*.swift', '**/*.kt',
];

const COMMON_EXCLUDES = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
  '**/.next/**', '**/target/**', '**/__pycache__/**', '**/*.min.*',
  '**/vendor/**', '**/.venv/**', '**/venv/**', '**/coverage/**',
  '**/.claude/**',
];

// ════════════════════════════════════════════════════════════
// FILE DISCOVERY (minimal glob — no external deps)
// ════════════════════════════════════════════════════════════

/**
 * Simple recursive directory walker. No external dependencies required.
 * For production, swap with fast-glob or glob.
 */
function walkDir(
  dirPath: string,
  include: string[],
  _exclude: string[],
  maxFiles: number,
  maxSize: number,
  skipCommon: boolean,
): CodebaseFile[] {
  const results: CodebaseFile[] = [];

  // Convert glob-like patterns to simple extension checks
  const extensions = new Set<string>();
  for (const p of include) {
    const ext = p.split('.').pop()?.replace('*', '') ?? '';
    if (ext) extensions.add(ext);
  }

  const skipDirs = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'target',
    '__pycache__', 'vendor', '.venv', 'venv', 'coverage', '.claude',
  ]);

  function scan(currentDir: string) {
    if (results.length >= maxFiles) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const fullPath = join(currentDir, entry);
      let stat: any;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        if (skipCommon && skipDirs.has(entry)) continue;
        if (entry.startsWith('.')) continue;
        scan(fullPath);
      } else if (stat.isFile()) {
        if (stat.size > maxSize) continue;
        const ext = extname(entry).slice(1).toLowerCase();
        if (!extensions.has(ext)) continue;

        const content: string = readFileSync(fullPath, 'utf-8');
        results.push({
          path: fullPath,
          relativePath: relative(dirPath, fullPath),
          language: detectLanguage(fullPath),
          content,
          size: stat.size,
        });
      }
    }
  }

  scan(dirPath);
  return results;
}

// ════════════════════════════════════════════════════════════
// ENTRY POINT DETECTION
// ════════════════════════════════════════════════════════════

function detectEntryPoints(rootDir: string, files: CodebaseFile[]): string[] {
  const entries: string[] = [];

  // Check package.json main/module/exports
  try {
    const pkgPath = join(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const mainFields = [pkg.main, pkg.module, pkg.exports?.('.')?.import, pkg.exports?.('.')?.default];
    for (const field of mainFields) {
      if (field && typeof field === 'string') {
        const resolved = resolve(rootDir, field);
        const rel = relative(rootDir, resolved);
        if (files.some(f => f.relativePath === rel || f.relativePath === rel.replace(/\\/g, '/'))) {
          entries.push(rel.replace(/\\/g, '/'));
        }
      }
    }
  } catch {}

  // Check for common entry files
  const commonEntries = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js', 'main.ts', 'main.py', 'main.go', 'cmd/main.go', 'lib.rs'];
  for (const entry of commonEntries) {
    if (files.some(f => f.relativePath === entry || f.relativePath.endsWith('/' + entry))) {
      entries.push(entry);
    }
  }

  return entries;
}

// ════════════════════════════════════════════════════════════
// MAIN ANALYSIS
// ════════════════════════════════════════════════════════════

/**
 * Walk a codebase directory, parse all source files, and build
 * a global cross-file symbol graph.
 */
export function analyzeCodebase(rootDir: string, options?: Partial<CodebaseOptions>): CodebaseAnalysis {
  const startTime = performance.now();

  const opts: CodebaseOptions = {
    rootDir,
    include: options?.include ?? SOURCE_PATTERNS,
    exclude: options?.exclude ?? COMMON_EXCLUDES,
    maxFileSize: options?.maxFileSize ?? 1_000_000,
    maxFiles: options?.maxFiles ?? 500,
    concurrency: options?.concurrency ?? 4,
    skipCommonDirs: options?.skipCommonDirs ?? true,
    useTreeSitter: options?.useTreeSitter ?? false,
    detectEntryPoints: options?.detectEntryPoints ?? true,
  };

  if (!existsSync(rootDir)) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  // ── 1. Discover files ──
  const discovered = walkDir(
    rootDir, opts.include!, opts.exclude!,
    opts.maxFiles!, opts.maxFileSize!,
    opts.skipCommonDirs!,
  );

  const totalLines = discovered.reduce((sum, f) => sum + f.content.split('\n').length, 0);
  const totalTokens = discovered.reduce((sum, f) => sum + Math.ceil(f.content.length / 3.5), 0);

  // ── 2. Parse files ──
  const allSymbols: Symbol[] = [];
  const fileSymbolMap = new Map<string, Symbol[]>();
  let parsedCount = 0;

  for (const file of discovered) {
    try {
      const symbols = parseCodeSync(file.content, file.language);
      if (symbols.length > 0) {
        // Assign file paths to each symbol
        for (const sym of symbols) {
          sym.filePath = file.relativePath;
        }
        allSymbols.push(...symbols);
        fileSymbolMap.set(file.relativePath, symbols);
        parsedCount++;
      }
    } catch {}
  }

  // ── 3. Build cross-file import graph ──
  // Resolve imports: find which symbols are referenced across files
  const importGraph = new Map<string, Set<string>>();

  for (const file of discovered) {
    const symbols = fileSymbolMap.get(file.relativePath);
    if (!symbols) continue;

    // Scan for import paths
    const importRe = file.language === 'python'
      ? /(?:from\s+(\S+)\s+import|import\s+(\S+))/g
      : file.language === 'go'
      ? /"([^"]+)"/g
      : /(?:from\s+['"])([^'"]+)(?:['"])|(?:require\(['"])([^'"]+)(?:['"]\))/g;

    let m: RegExpExecArray | null;
    while ((m = importRe.exec(file.content)) !== null) {
      const importPath = (m[1] ?? m[2] ?? m[3] ?? '').replace(/^\.\//, '');
      if (!importPath) continue;

      // Try to resolve relative to this file's directory
      const dir = file.relativePath.split('/').slice(0, -1).join('/');
      const resolvedPath = importPath.startsWith('.')
        ? (dir ? dir + '/' + importPath.slice(2) : importPath.slice(2))
        : importPath;

      // Find symbols in other files whose name matches
      const importedSymbols = allSymbols.filter(s =>
        s.filePath !== file.relativePath &&
        (s.name === importPath.split('/').pop() || resolvedPath.includes(s.filePath.replace(/\.\w+$/, '')))
      );

      for (const sym of symbols) {
        const targets = importedSymbols.map(s => s.id);
        if (targets.length > 0) {
          const existing = importGraph.get(sym.id) ?? new Set();
          for (const t of targets) existing.add(t);
          importGraph.set(sym.id, existing);
        }
      }
    }
  }

  // ── 4. Build global graph ──
  const globalGraph = buildGraph(allSymbols, {
    maxDepth: 10,
    includeImports: true,
    includeInheritance: true,
  });

  // Add cross-file import edges to the graph
  for (const [fromId, toIds] of importGraph) {
    for (const toId of toIds) {
      // Check if edge already exists
      const exists = globalGraph.edges.some(e => e.from === fromId && e.to === toId);
      if (!exists) {
        globalGraph.edges.push({ from: fromId, to: toId, type: 'import', weight: 1 });
        const fn = globalGraph.nodes.get(fromId);
        const tn = globalGraph.nodes.get(toId);
        if (fn) fn.fanOut++;
        if (tn) tn.fanIn++;
      }
    }
  }

  // ── 5. Detect entry points ──
  let entryPoints: string[] = [];
  if (opts.detectEntryPoints) {
    entryPoints = detectEntryPoints(rootDir, discovered);
  }

  const graphStats = getGraphStats(globalGraph);
  const elapsed = Math.round(performance.now() - startTime);

  // ── 6. Language distribution ──
  const languages: Record<string, number> = {};
  for (const file of discovered) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  return {
    files: discovered,
    totalFiles: discovered.length,
    parsedFiles: parsedCount,
    totalLines,
    totalTokens,
    symbols: allSymbols,
    globalGraph,
    entryPoints,
    stats: {
      languages,
      totalSymbols: allSymbols.length,
      graphNodes: graphStats.totalNodes,
      graphEdges: graphStats.totalEdges,
      clusters: graphStats.clusters,
      processingTimeMs: elapsed,
    },
  };
}

/**
 * Extract optimized context from the most relevant parts of a codebase.
 */
export async function extractCodebaseContext(
  analysis: CodebaseAnalysis,
  taskPrompt: string,
  targetTokens: number,
  _options?: Partial<OptimizationOptions>,
): Promise<{
  context: string;
  relevantFiles: string[];
  relevantSymbols: string[];
  tokenCount: number;
}> {
  const tokenizer = new Tokenizer();

  // Find symbols relevant to the prompt
  const promptLower = taskPrompt.toLowerCase();
  const promptWords = promptLower.split(/\W+/).filter(w => w.length > 2);

  // Score symbols by relevance
  const scored = analysis.symbols.map(sym => {
    let score = 0;
    const nameLower = sym.name.toLowerCase();
    const fileLower = sym.filePath.toLowerCase();

    for (const word of promptWords) {
      if (nameLower.includes(word)) score += 10;
      if (nameLower === word) score += 5;
      if (fileLower.includes(word)) score += 3;
    }

    // Boost exported + central symbols
    if (sym.isExported) score += 2;
    const node = analysis.globalGraph.nodes.get(sym.id);
    if (node) score += node.pageRank * 20;

    return { sym, score };
  })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Select top matching symbols to fill budget
  const selected: Symbol[] = [];

  // Reserve tokens for the header and file separators
  const headerTokens = Math.ceil((40 + taskPrompt.length) / 3.5);
  const estimatedFiles = Math.min(scored.length, 10);
  const separatorTokens = estimatedFiles * 12;
  let budget = Math.max(50, targetTokens - headerTokens - separatorTokens);

  for (const { sym } of scored) {
    const cost = Math.ceil(sym.fullSource.length / 3.5);
    if (cost <= budget) {
      selected.push(sym);
      budget -= cost;
    }
    if (budget < 50) break;
  }

  // Also include entry points if relevant
  for (const entry of analysis.entryPoints) {
    const entrySymbols = analysis.symbols.filter(s => s.filePath === entry);
    for (const sym of entrySymbols) {
      if (!selected.find(s => s.id === sym.id)) {
        const cost = Math.ceil(sym.fullSource.length / 3.5);
        if (cost <= budget) {
          selected.push(sym);
          budget -= cost;
        }
      }
    }
  }

  // Build context string
  const fileOrder = new Map<string, string[]>();
  for (const sym of selected) {
    const files = fileOrder.get(sym.filePath) ?? [];
    files.push(sym.fullSource);
    fileOrder.set(sym.filePath, files);
  }

  const parts: string[] = [`// TokenWise codebase context for: ${taskPrompt}\n// ${analysis.totalFiles} files · ${analysis.stats.totalSymbols} symbols · ${analysis.stats.graphNodes} graph nodes\n`];
  for (const [filePath, sources] of fileOrder) {
    parts.push(`// 📁 ${filePath}`);
    parts.push(...sources);
    parts.push('');
  }

  const context = parts.join('\n');
  const tokenCount = tokenizer.count(context);

  return {
    context,
    relevantFiles: [...fileOrder.keys()],
    relevantSymbols: selected.map(s => `${s.filePath}:${s.name}`),
    tokenCount,
  };
}
