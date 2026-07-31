/**
 * TokenWise Core — Symbol-Aware Context Distillation Engine
 *
 * Entry point for the core library. Re-exports all public APIs.
 */

// Types
export * from './types.js';

// Parsing
export { parseCode, parseCodeSync, detectLanguage, findRelevantSymbols } from './parser/index.js';
export type { ParserResult } from './parser/index.js';

// Tokenizer
export { Tokenizer, CodeTokenEstimator, countTokens, estimateTokens, estimateTokensFast, splitToFit, tokensToChars, formatTokenComparison, defaultTokenizer } from './tokenizer/index.js';
export type { TokenizerOptions, TokenizerStats, TokenEstimate } from './tokenizer/index.js';

// Extraction Pipeline
export { optimizeContext, optimizeContextSync, compressContext, extractDiff, optimizeMultiFile, optimizeMultiFileSync } from './extractors/index.js';

// Compression
export { compress, smartCompress, compressFull, estimateCompression } from './compressors/index.js';
export type { CompressionOptions, CompressionResult } from './types.js';

// Symbol Graph
export { buildGraph, findShortestPath, findHotPath, findOrphanedSymbols, findEntryCandidates, getGraphStats } from './graph/index.js';
export type { GraphBuildOptions, GraphQueryResult } from './graph/index.js';

// Strategy Engine
export { selectStrategy, rankSymbols, applyStrategySelection, allocateBudget, STRATEGY_PROFILES } from './strategies/index.js';
export type { SelectedStrategy, BudgetAllocation, RankedSymbol } from './strategies/index.js';

// Codebase Walker
export { analyzeCodebase, extractCodebaseContext } from './codebase/index.js';
export type { CodebaseFile, CodebaseAnalysis, CodebaseOptions } from './codebase/index.js';

// MCP Integration
export { handleToolCall, TOOL_DEFINITIONS } from './mcp/index.js';
export type { McpToolDefinition, McpToolResponse } from './mcp/index.js';
