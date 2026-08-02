/**
 * TokenWise Action — pure, testable logic.
 *
 * This module is kept free of environment, process, and I/O concerns so the
 * optimization pipeline can be unit-tested directly without GitHub runner
 * env vars or filesystem access.
 */

import { extractCodebaseContext } from '@tokenwise/core';
import type { CodebaseAnalysis } from '@tokenwise/core';

export interface OptimizedContextResult {
  /** The distilled, token-budgeted context text */
  context: string;
  /** Files that contributed symbols to the context */
  relevantFiles: string[];
  /** Symbols included in the context, as `file:name` pairs */
  relevantSymbols: string[];
  /** Measured token count of the generated context */
  tokenCount: number;
}

/**
 * Build an optimized context for a given task prompt and token budget.
 *
 * Pure function: takes a codebase analysis (produced by `analyzeCodebase`)
 * and runs the core extraction pipeline against it. No env vars, no I/O —
 * fully unit-testable.
 */
export async function buildOptimizedContext(
  analysis: CodebaseAnalysis,
  taskPrompt: string,
  targetTokens: number,
): Promise<OptimizedContextResult> {
  const extracted = await extractCodebaseContext(analysis, taskPrompt, targetTokens);

  return {
    context: extracted.context,
    relevantFiles: extracted.relevantFiles,
    relevantSymbols: extracted.relevantSymbols,
    tokenCount: extracted.tokenCount,
  };
}
