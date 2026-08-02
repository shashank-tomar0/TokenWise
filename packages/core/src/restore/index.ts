/**
 * TokenWise Context Restoration Map — reversible code compression
 *
 * Provides a mapping from optimized context back to original symbols,
 * enabling on-demand decompression of specific sections. This is
 * analogous to Headroom's CCR (Cached Compression with Retrieval)
 * but designed specifically for code with symbol-level granularity.
 */

import type { Symbol, OptimizationResult, Language } from '../types.js';
import { parseCodeSync, detectLanguage } from '../parser/index.js';

// ════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════

/**
 * A single entry in the restoration map — links an optimized chunk
 * to the original symbols it was derived from.
 */
export interface RestoreEntry {
  /** Unique ID of the chunk in the optimized output */
  chunkId: string;
  /** Names of symbols this chunk represents (file:name format) */
  symbolNames: string[];
  /** Full original source of each symbol */
  originalSources: string[];
  /** Start line of this chunk in optimized output */
  startLine: number;
  /** Token count of the original combined sources */
  tokenCount: number;
}

/**
 * The complete restoration map — bidirectional lookup.
 */
export interface RestoreMap {
  /** All entries, indexed by chunk ID */
  entries: RestoreEntry[];
  /** Fast lookup: symbol name (file:name) → original source */
  bySymbol: Map<string, string>;
  /** Fast lookup: chunk ID → entry */
  byChunk: Map<string, RestoreEntry>;
  /** Total original tokens that were compressed */
  totalOriginalTokens: number;
  /** Total compressed tokens */
  totalCompressedTokens: number;
}

// ════════════════════════════════════════════════════════════
// CREATION
// ════════════════════════════════════════════════════════════

/**
 * Build a restoration map from the original symbols and an optimization result.
 * This enables on-demand decompression of any compressed symbol.
 *
 * @param originalSymbols — All symbols extracted from the original codebase (parseCodeSync output)
 * @param optimizedResult — The OptimizationResult returned by optimizeContext or optimizeContextSync
 * @returns A RestoreMap for on-demand decompression
 */
export function createRestoreMap(
  originalSymbols: ReturnType<typeof parseCodeSync>,
  optimizedResult: OptimizationResult,
): RestoreMap {
  const entries: RestoreEntry[] = [];
  const bySymbol = new Map<string, string>();
  const byChunk = new Map<string, RestoreEntry>();
  let totalOriginalTokens = 0;
  let totalCompressedTokens = 0;

  // Index original symbols by name for fast lookup
  const symbolsByName = new Map<string, Symbol>();
  for (const sym of originalSymbols) {
    const key = `${sym.filePath}:${sym.name}`;
    symbolsByName.set(key, sym);
  }

  // Process each chunk in the optimized result
  for (const chunk of optimizedResult.chunks) {
    const chunkId = `chunk:${chunk.startLine}-${chunk.endLine}`;
    const symbolNames = chunk.symbols; // e.g., ["parseUser"]
    const originalSources: string[] = [];

    for (const name of symbolNames) {
      const sym = symbolsByName.get(name);
      if (sym) {
        originalSources.push(sym.fullSource);
        const key = `${sym.filePath}:${sym.name}`;
        bySymbol.set(key, sym.fullSource);
        totalOriginalTokens += Math.ceil(sym.fullSource.length / 3.5);
      }
    }

    const compressedTokens = chunk.tokenCount;
    totalCompressedTokens += compressedTokens;

    const entry: RestoreEntry = {
      chunkId,
      symbolNames,
      originalSources,
      startLine: chunk.startLine,
      tokenCount: compressedTokens,
    };

    entries.push(entry);
    byChunk.set(chunkId, entry);
  }

  return {
    entries,
    bySymbol,
    byChunk,
    totalOriginalTokens,
    totalCompressedTokens,
  };
}

/**
 * Create a restoration map directly from original code and its optimized version.
 * Convenience wrapper that parses the original code internally.
 */
export function createRestoreMapFromCode(
  originalCode: string,
  optimizedResult: OptimizationResult,
  language?: Language,
): RestoreMap {
  const lang = language ?? detectLanguage('');
  const originalSymbols = parseCodeSync(originalCode, lang);
  return createRestoreMap(originalSymbols, optimizedResult);
}

// ════════════════════════════════════════════════════════════
// LOOKUP
// ════════════════════════════════════════════════════════════

/**
 * Restore the full original source for a single symbol.
 * @param restoreMap — Map created by createRestoreMap
 * @param symbolName — Symbol name in `file:name` format (as returned by OptimizationResult)
 * @returns Full original source, or undefined if not found in the map
 */
export function restoreSymbol(
  restoreMap: RestoreMap,
  symbolName: string,
): string | undefined {
  return restoreMap.bySymbol.get(symbolName);
}

/**
 * Restore all original sources for a given chunk.
 * @param restoreMap — Map created by createRestoreMap
 * @param chunkId — Chunk ID (e.g., "chunk:5-20")
 * @returns Array of original sources, or undefined if chunk not found
 */
export function restoreChunk(
  restoreMap: RestoreMap,
  chunkId: string,
): string[] | undefined {
  const entry = restoreMap.byChunk.get(chunkId);
  return entry?.originalSources;
}

/**
 * Get the full original source for all symbols in a chunk.
 */
export function getOriginalSourcesForChunk(
  restoreMap: RestoreMap,
  chunkId: string,
): string[] {
  const entry = restoreMap.byChunk.get(chunkId);
  return entry?.originalSources ?? [];
}

// ════════════════════════════════════════════════════════════
// FORMATTING
// ════════════════════════════════════════════════════════════

/**
 * Human-readable summary of what was compressed and how to restore it.
 */
export function formatRestoreMap(restoreMap: RestoreMap): string {
  const lines: string[] = [
    '=== TokenWise Context Restoration Map ===',
    `Total original tokens: ${restoreMap.totalOriginalTokens}`,
    `Total compressed tokens: ${restoreMap.totalCompressedTokens}`,
    `Compression ratio: ${(restoreMap.totalOriginalTokens / Math.max(1, restoreMap.totalCompressedTokens)).toFixed(2)}x`,
    `Entries: ${restoreMap.entries.length}`,
    '',
    'Entries:',
  ];

  for (const entry of restoreMap.entries) {
    lines.push(`  ${entry.chunkId} (${entry.tokenCount} tok):`);
    for (const name of entry.symbolNames) {
      lines.push(`    - ${name}`);
    }
  }

  return lines.join('\n');
}

/**
 * CLI-friendly class wrapping the restore utilities.
 */
export class Restore {
  /** Create a map from original symbols + optimized result. */
  static create(originalSymbols: ReturnType<typeof parseCodeSync>, result: OptimizationResult): RestoreMap {
    return createRestoreMap(originalSymbols, result);
  }

  /** Create a map from original code + optimized result. */
  static fromCode(code: string, result: OptimizationResult, language?: Language): RestoreMap {
    return createRestoreMapFromCode(code, result, language);
  }

  /** Restore a single symbol. */
  static symbol(map: RestoreMap, name: string): string | undefined {
    return restoreSymbol(map, name);
  }

  /** Restore a chunk. */
  static chunk(map: RestoreMap, chunkId: string): string[] | undefined {
    return restoreChunk(map, chunkId);
  }

  /** Print human-readable map. */
  static text(map: RestoreMap): string {
    return formatRestoreMap(map);
  }
}