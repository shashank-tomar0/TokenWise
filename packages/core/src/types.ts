import { z } from 'zod';

/**
 * TokenWise — Production-Grade Token Optimization Engine
 *
 * Complete type definitions for the symbol-aware context distillation pipeline.
 * Supports: AST parsing (tree-sitter), real BPE tokenization (tiktoken),
 * call-graph analysis, adaptive extraction strategies, model-specific profiles.
 */

// ════════════════════════════════════════════════════════════
// CORE ENUMS & SCHEMAS
// ════════════════════════════════════════════════════════════

export const LanguageSchema = z.enum([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java',
  'cpp', 'c', 'ruby', 'php', 'csharp', 'swift', 'kotlin',
]);
export type Language = z.infer<typeof LanguageSchema>;

export const TokenEncodingSchema = z.enum([
  'cl100k_base',   // GPT-4, GPT-3.5, Claude
  'p50k_base',     // Codex, text-davinci-002
  'r50k_base',     // GPT-3.5-turbo, text-davinci-003
  'o200k_base',    // GPT-4 Turbo, GPT-4o
]);
export type TokenEncoding = z.infer<typeof TokenEncodingSchema>;

export const StrategySchema = z.enum([
  'aggressive',    // Maximum compression — signatures only for non-critical
  'balanced',      // Balanced — full bodies for important, signatures for rest
  'preservative',  // Keep more context — full bodies, keep most docs
  'semantic',      // Based on semantic importance scoring
  'adaptive',      // Auto-adjusts based on model, code, and task context
]);
export type ExtractionStrategy = z.infer<typeof StrategySchema>;

export const TaskTypeSchema = z.enum([
  'bug-fix',
  'feature-add',
  'code-review',
  'refactor',
  'explain',
  'document',
  'test-write',
  'general',
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const SymbolTypeSchema = z.enum([
  'function', 'asyncFunction', 'arrowFunction', 'method',
  'class', 'interface', 'typeAlias', 'enum',
  'constant', 'variable', 'import', 'export',
  'module', 'namespace', 'decorator', 'jsxComponent',
  'property', 'parameter', 'constructor', 'getter', 'setter',
]);
export type SymbolType = z.infer<typeof SymbolTypeSchema>;

export const ModelSchema = z.enum([
  'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
  'gemini-pro',
  'local',
]);
export type Model = z.infer<typeof ModelSchema>;

export const EdgeTypeSchema = z.enum([
  'import', 'call', 'inheritance', 'composition', 'type', 'implementation',
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

// ════════════════════════════════════════════════════════════
// CORE TYPES
// ════════════════════════════════════════════════════════════

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/**
 * A code symbol — function, class, interface, variable, etc.
 */
export interface Symbol {
  id: string;
  name: string;
  type: SymbolType;

  // Location
  filePath: string;
  range: Range;
  startLine: number;
  endLine: number;

  // Content
  signature: string;       // Declaration without body
  fullSource: string;      // Complete source including body
  bodyHash?: string;       // SHA-256 of body content (for change detection)

  // Documentation
  documentation?: string;  // JSDoc / docstring
  comments?: string[];     // Inline comments

  // Semantics
  visibility: 'public' | 'private' | 'protected' | 'internal';
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;

  // Dependencies
  dependencies: string[];  // IDs of symbols this uses
  dependents: string[];    // IDs of symbols that use this
  importStatements: string[];

  // Importance scoring
  importanceScore: number; // Calculated 0–100
  callCount: number;
  lineCount: number;

  // AST metadata
  complexity: number;      // Cyclomatic complexity
  parameters: Parameter[];

  // Grouping
  parent?: string;
  children: string[];
}

export interface Parameter {
  name: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: string;
}

export interface FileContext {
  path: string;
  language: Language;
  content: string;
  sizeBytes: number;
  lastModified?: number;

  // Extracted data
  symbols: Map<string, Symbol>;
  importStatements: ImportStatement[];
  exportStatements: ExportStatement[];

  // Analysis
  complexity: number;
  lineCount: number;
  tokenCount: number;
}

export interface ImportStatement {
  path: string;
  named: string[];
  default?: string;
  namespace?: string;
  isTypeOnly: boolean;
  isSideEffect: boolean;
}

export interface ExportStatement {
  names: string[];
  isReExport: boolean;
  from?: string;
  isDefault: boolean;
  isTypeOnly: boolean;
}

// ════════════════════════════════════════════════════════════
// SYMBOL GRAPH
// ════════════════════════════════════════════════════════════

export interface SymbolGraph {
  nodes: Map<string, SymbolNode>;
  edges: SymbolEdge[];
}

export interface SymbolNode {
  id: string;
  symbol: Symbol;
  centrality: number;      // PageRank-style centrality
  fanIn: number;            // Dependencies on this symbol
  fanOut: number;           // This symbol's outgoing edges
  clusterId: number;        // Community detection cluster
  pageRank: number;         // PageRank score
  depth: number;            // Depth from entry points
}

export interface SymbolEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight: number;
  locations?: Range[];      // Source locations where this edge is referenced
}

// ════════════════════════════════════════════════════════════
// OPTIMIZATION OPTIONS
// ════════════════════════════════════════════════════════════

export interface OptimizationOptions {
  // Context constraints
  maxTokens?: number;
  targetTokens?: number;
  minCompleteness?: number; // 0–100, minimum context completeness

  // Model-specific
  model?: Model;
  encoding?: TokenEncoding;

  // Task context
  taskType?: TaskType;
  taskPrompt?: string;      // The user's actual prompt — used for semantic ranking

  // What to include
  includeSignatures?: boolean;
  includeBodies?: boolean;
  includeDocumentation?: boolean;
  includeImports?: boolean;
  includeExports?: boolean;
  includeTypeDefinitions?: boolean;

  // Filtering
  relevantSymbols?: string[];
  ignoreSymbols?: string[];
  focusFiles?: string[];

  // Graph analysis
  analyzeCallGraph?: boolean;
  callGraphDepth?: number;
  prioritizeHotPaths?: boolean;

  // Strategy
  strategy?: ExtractionStrategy;

  // Language
  language?: Language;

  // Performance
  enableCaching?: boolean;
  maxProcessingTimeMs?: number;
  enableParallelProcessing?: boolean;

  // Output format
  outputFormat?: 'minimal' | 'standard' | 'verbose' | 'debug';
}

export interface OptimizationResult {
  // Content
  code: string;
  chunks: CodeChunk[];

  // Token stats
  originalTokens: number;
  optimizedTokens: number;
  reductionTokens: number;
  reductionPercent: number;
  compressionRatio: number;

  // Metadata
  strategy: ExtractionStrategy;
  model: Model;
  encoding: TokenEncoding;
  processingTimeMs: number;
  taskType: TaskType;

  // Symbols
  includedSymbols: string[];
  excludedSymbols: string[];
  totalSymbolsFound: number;

  // Files
  filePath?: string;
  language: Language;

  // Quality metrics
  estimatedCompleteness: number;  // 0–100
  semanticCoverage: number;       // 0–100

  // Call graph stats (if analyzed)
  callGraphStats?: {
    totalNodes: number;
    totalEdges: number;
    maxDepth: number;
    clusters: number;
  };
}

export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  symbols: string[];
  priority: number;
  chunkType: 'header' | 'symbol' | 'import' | 'dependency' | 'context' | 'footer';
}

export interface HierarchicalContext {
  files: FileContext[];
  entryPoints: string[];
  symbolGraph: SymbolGraph;
  budgets: {
    critical: number;
    important: number;
    relevant: number;
  };
}

// ════════════════════════════════════════════════════════════
// COMPRESSION
// ════════════════════════════════════════════════════════════

export interface CompressionOptions {
  removeComments?: boolean;
  removeBlankLines?: boolean;
  collapseWhitespace?: boolean;
  minify?: boolean;
  removeConsoleLogs?: boolean;
  removeDebugCode?: boolean;
  removeDeadCode?: boolean;
  preserveShebang?: boolean;
  preserveLicense?: boolean;
  preserveImportantComments?: boolean;
  importantCommentPatterns?: string[];
  // Type-specific
  collapseObjectLiterals?: boolean;
  shortenIdentifiers?: boolean; // Only for aggressive
  removeTypeAnnotations?: boolean; // Only when type info is preserved elsewhere
}

export interface CompressionResult {
  code: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  removedPatterns: Array<{
    type: string;
    count: number;
    estimatedTokensSaved: number;
  }>;
}

// ════════════════════════════════════════════════════════════
// STRATEGY ENGINE
// ════════════════════════════════════════════════════════════

export interface StrategyProfile {
  name: ExtractionStrategy;
  description: string;
  // Weight adjustments per strategy
  symbolBodyWeight: number;      // 0.0–1.0: how many symbols keep full bodies
  commentWeight: number;          // 0.0–1.0: how many docs/comments to keep
  importDensity: number;          // 0.0–1.0: how many imports to include
  graphDepth: number;             // Max call-graph depth to traverse
  aggressiveMinify: boolean;
}

// ════════════════════════════════════════════════════════════
// MODEL PROFILES
// ════════════════════════════════════════════════════════════

export interface ModelProfile {
  model: Model;
  maxTokens: number;
  recommendedTokens: number;
  encoding: TokenEncoding;
  /** How well the model handles long context (1=best to use full window, 5=keep it short) */
  contextPenalty: 1 | 2 | 3 | 4 | 5;
  /** Recommended strategy for this model */
  recommendedStrategy: ExtractionStrategy;
}

// ════════════════════════════════════════════════════════════
// PARSER
// ════════════════════════════════════════════════════════════

export interface ParserConfig {
  language: Language;
  includeComments: boolean;
  includeDocstrings: boolean;
  maxFileSizeBytes: number;
  parseTimeoutMs: number;
}

export interface ParseResult {
  symbols: Symbol[];
  imports: ImportStatement[];
  exports: ExportStatement[];
  diagnostics: Diagnostic[];
  parseTimeMs: number;
  treeSitterAvailable: boolean;
}

// ════════════════════════════════════════════════════════════
// GRAPH ANALYSIS
// ════════════════════════════════════════════════════════════

export interface CallGraphOptions {
  includeImports: boolean;
  includeInheritance: boolean;
  maxDepth: number;
  entryPoints?: string[];
  ignorePatterns?: RegExp[];
}

export interface GraphAnalysisResult {
  graph: SymbolGraph;
  hotPaths: string[];
  criticalSymbols: string[];
  orphanedSymbols: string[];
  clusters: number;
  diameter: number;
}

// ════════════════════════════════════════════════════════════
// DIAGNOSTICS & METRICS
// ════════════════════════════════════════════════════════════

export interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  location?: Range;
  suggestion?: string;
}

export interface PerformanceMetrics {
  parseTimeMs: number;
  extractTimeMs: number;
  rankTimeMs: number;
  graphAnalysisTimeMs: number;
  serializeTimeMs: number;
  totalTimeMs: number;
  memoryUsedBytes?: number;
  cacheHitRate?: number;
}

export interface AnalysisResult {
  file: FileContext;
  symbols: RankedSymbol[];
  hotPaths: string[];
  criticalSymbols: string[];
  diagnostics: Diagnostic[];
  metrics: PerformanceMetrics;
}

export interface RankedSymbol extends Symbol {
  rank: number;
  rankFactors: Record<string, number>;
  reason: string;
}

export interface RankerWeights {
  visibility: number;
  callFrequency: number;
  centrality: number;
  typeImportance: number;
  complexity: number;
  recency: number;
  taskRelevance: number;
}

// ════════════════════════════════════════════════════════════
// CACHE
// ════════════════════════════════════════════════════════════

export interface CacheOptions {
  backend: 'memory' | 'disk' | 'redis';
  ttlSeconds: number;
  maxSize: number;
  namespace: string;
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  sizeBytes: number;
}

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════

export interface TokenWiseConfig {
  defaultModel: Model;
  defaultEncoding: TokenEncoding;
  defaultStrategy: ExtractionStrategy;
  modelProfiles: Record<Model, ModelProfile>;
  enableCache: boolean;
  cacheTTL: number;
  maxProcessingTimeMs: number;
  enableParallelProcessing: boolean;
  minCompleteness: number;
  preserveCriticalSymbols: boolean;
  analyzeDependencies: boolean;
}

// ════════════════════════════════════════════════════════════
// DEFAULTS
// ════════════════════════════════════════════════════════════

export const DEFAULT_ENCODING: TokenEncoding = 'cl100k_base';
export const DEFAULT_STRATEGY: ExtractionStrategy = 'adaptive';

export const MODEL_PROFILES: Record<Model, ModelProfile> = {
  'claude-3-opus':   { model: 'claude-3-opus', maxTokens: 200_000, recommendedTokens: 180_000, encoding: 'cl100k_base', contextPenalty: 1, recommendedStrategy: 'preservative' },
  'claude-3-sonnet': { model: 'claude-3-sonnet', maxTokens: 200_000, recommendedTokens: 150_000, encoding: 'cl100k_base', contextPenalty: 2, recommendedStrategy: 'balanced' },
  'claude-3-haiku':  { model: 'claude-3-haiku', maxTokens: 200_000, recommendedTokens: 150_000, encoding: 'cl100k_base', contextPenalty: 2, recommendedStrategy: 'balanced' },
  'claude-opus-4':   { model: 'claude-opus-4', maxTokens: 200_000, recommendedTokens: 180_000, encoding: 'cl100k_base', contextPenalty: 1, recommendedStrategy: 'preservative' },
  'claude-sonnet-4': { model: 'claude-sonnet-4', maxTokens: 200_000, recommendedTokens: 150_000, encoding: 'cl100k_base', contextPenalty: 2, recommendedStrategy: 'balanced' },
  'claude-haiku-4':  { model: 'claude-haiku-4', maxTokens: 200_000, recommendedTokens: 150_000, encoding: 'cl100k_base', contextPenalty: 2, recommendedStrategy: 'balanced' },
  'gpt-4-turbo':     { model: 'gpt-4-turbo', maxTokens: 128_000, recommendedTokens: 100_000, encoding: 'o200k_base', contextPenalty: 2, recommendedStrategy: 'balanced' },
  'gpt-4':           { model: 'gpt-4', maxTokens: 8_192, recommendedTokens: 6_000, encoding: 'cl100k_base', contextPenalty: 4, recommendedStrategy: 'aggressive' },
  'gpt-3.5-turbo':   { model: 'gpt-3.5-turbo', maxTokens: 16_385, recommendedTokens: 12_000, encoding: 'cl100k_base', contextPenalty: 4, recommendedStrategy: 'aggressive' },
  'gemini-pro':      { model: 'gemini-pro', maxTokens: 30_720, recommendedTokens: 25_000, encoding: 'cl100k_base', contextPenalty: 3, recommendedStrategy: 'balanced' },
  'local':           { model: 'local', maxTokens: 8_192, recommendedTokens: 4_000, encoding: 'cl100k_base', contextPenalty: 5, recommendedStrategy: 'aggressive' },
};

export const DEFAULT_CONFIG: TokenWiseConfig = {
  defaultModel: 'claude-3-sonnet',
  defaultEncoding: DEFAULT_ENCODING,
  defaultStrategy: DEFAULT_STRATEGY,
  modelProfiles: MODEL_PROFILES,
  enableCache: true,
  cacheTTL: 3_600,
  maxProcessingTimeMs: 5_000,
  enableParallelProcessing: true,
  minCompleteness: 70,
  preserveCriticalSymbols: true,
  analyzeDependencies: true,
};
