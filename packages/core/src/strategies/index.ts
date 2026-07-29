/**
 * TokenWise Adaptive Strategy Engine
 *
 * Selects and configures the optimal extraction strategy based on:
 *   - Target model context limits & characteristics
 *   - Codebase size and complexity
 *   - Task type (bug-fix, explain, refactor, etc.)
 *   - Available token budget
 *
 * Each strategy encodes specific compression/retention profiles
 * that control what gets kept vs stripped from the final context.
 */

import type {
  ExtractionStrategy,
  StrategyProfile,
  Model,
  TaskType,
  Language,
  Symbol,
  ModelProfile,
} from '../types.js';

// ────────────────────────────────────────────────────────────
// STRATEGY PROFILES
// ────────────────────────────────────────────────────────────

export const STRATEGY_PROFILES: Record<ExtractionStrategy, StrategyProfile> = {
  aggressive: {
    name: 'aggressive',
    description: 'Maximum compression — signatures only for non-critical symbols, aggressive minification',
    symbolBodyWeight: 0.1,    // Only keep bodies for top 10% of symbols
    commentWeight: 0.0,       // Strip all comments
    importDensity: 0.3,       // Keep only direct imports
    graphDepth: 1,            // Only immediate callees
    aggressiveMinify: true,
  },
  balanced: {
    name: 'balanced',
    description: 'Moderate compression — full bodies for high-importance, signatures for rest',
    symbolBodyWeight: 0.4,    // Bodies for top 40%
    commentWeight: 0.2,       // Keep JSDoc/docstrings
    importDensity: 0.6,       // Keep most imports
    graphDepth: 2,            // Two layers of deps
    aggressiveMinify: false,
  },
  preservative: {
    name: 'preservative',
    description: 'Minimal compression — keep most context, good for large-context models',
    symbolBodyWeight: 0.8,    // Bodies for top 80%
    commentWeight: 0.7,       // Keep most docs
    importDensity: 0.9,       // Keep nearly all imports
    graphDepth: 3,            // Three layers deep
    aggressiveMinify: false,
  },
  semantic: {
    name: 'semantic',
    description: 'Importance-driven — keep only what matters based on call-graph and relevance scoring',
    symbolBodyWeight: 0.3,    // Bodies for high-scored only
    commentWeight: 0.1,       // Strip all but critical docs
    importDensity: 0.5,       // Smart import selection
    graphDepth: 2,
    aggressiveMinify: false,
  },
  adaptive: {
    name: 'adaptive',
    description: 'Auto-selects the best strategy based on model, code, and task context',
    symbolBodyWeight: 0.4,
    commentWeight: 0.3,
    importDensity: 0.6,
    graphDepth: 2,
    aggressiveMinify: false,  // Determined dynamically
  },
};

// ────────────────────────────────────────────────────────────
// TASK TYPE PROFILES
// ────────────────────────────────────────────────────────────

/**
 * Per-task-type adjustments to the base strategy.
 * Multipliers applied to weights (1.0 = no change).
 */
const TASK_ADJUSTMENTS: Record<TaskType, {
  symbolBody: number;   // >1.0 = more bodies, <1.0 = fewer
  comment: number;      // >1.0 = keep more comments
  imports: number;      // >1.0 = keep more imports
  minify: number;       // 0 = disabled, 1 = enabled
}> = {
  'bug-fix':    { symbolBody: 0.7,  comment: 0.2,  imports: 0.5,  minify: 1 },  // Strip docs, keep structure
  'feature-add': { symbolBody: 0.9,  comment: 0.5,  imports: 0.8,  minify: 0 },  // Need full context
  'code-review': { symbolBody: 1.0,  comment: 0.8,  imports: 0.9,  minify: 0 },  // Need everything
  'refactor':   { symbolBody: 0.8,  comment: 0.4,  imports: 0.7,  minify: 0 },  // Moderate
  'explain':    { symbolBody: 0.5,  comment: 1.0,  imports: 0.6,  minify: 0 },  // Keep docs
  'document':   { symbolBody: 0.4,  comment: 1.0,  imports: 0.5,  minify: 0 },  // Docs matter most
  'test-write': { symbolBody: 0.8,  comment: 0.3,  imports: 0.8,  minify: 0 },  // Structure + imports
  'general':    { symbolBody: 1.0,  comment: 0.5,  imports: 0.8,  minify: 0 },
};

// ────────────────────────────────────────────────────────────
// BUDGET ALLOCATION
// ────────────────────────────────────────────────────────────

export interface BudgetAllocation {
  /** Tokens reserved for critical/high-priority symbols */
  criticalBudget: number;
  /** Tokens reserved for important symbols (bodies or sigs) */
  importantBudget: number;
  /** Tokens reserved for relevant symbols (signatures) */
  relevantBudget: number;
  /** Tokens for imports and dependencies */
  dependencyBudget: number;
  /** Tokens for optional documentation */
  documentationBudget: number;
}

/**
 * Allocate token budget across categories based on model and strategy.
 */
export function allocateBudget(
  totalBudget: number,
  strategy: StrategyProfile,
  modelProfile: ModelProfile | null,
): BudgetAllocation {
  // Models with aggressive context penalties shift more budget to critical
  const contextPenaltyFactor = modelProfile
    ? 1.0 - (modelProfile.contextPenalty - 1) * 0.1
    : 1.0;

  const baseCritical = 0.25 * contextPenaltyFactor;
  const baseImportant = 0.35 * contextPenaltyFactor;
  const baseDependencies = 0.15;
  const baseDocumentation = 0.05 * strategy.commentWeight;
  const remaining = 1.0 - baseCritical - baseImportant - baseDependencies - baseDocumentation;

  return {
    criticalBudget: Math.floor(totalBudget * baseCritical),
    importantBudget: Math.floor(totalBudget * baseImportant),
    relevantBudget: Math.floor(totalBudget * remaining),
    dependencyBudget: Math.floor(totalBudget * baseDependencies),
    documentationBudget: Math.floor(totalBudget * baseDocumentation),
  };
}

// ────────────────────────────────────────────────────────────
// STRATEGY SELECTOR
// ────────────────────────────────────────────────────────────

export interface SelectedStrategy {
  profile: StrategyProfile;
  budget: BudgetAllocation;
  symbolBodyThreshold: number;   // Importance score needed to keep body
  minifyEnabled: boolean;
  maxGraphDepth: number;
  importThreshold: number;       // 0–1, fraction of imports to keep
  keepComments: boolean;
  keepDocstrings: boolean;
}

/**
 * Select the optimal strategy config for the given context.
 *
 * @param baseStrategy  Requested strategy or 'adaptive' for auto-select
 * @param model         Target model
 * @param taskType      What the user is trying to do
 * @param totalBudget   Token budget available
 * @param codeSize      Total code size in characters (for auto-tuning)
 * @param language      Programming language
 */
export function selectStrategy(
  baseStrategy: ExtractionStrategy,
  model: Model,
  taskType: TaskType = 'general',
  totalBudget: number,
  codeSize: number = 0,
  _language: Language = 'typescript',
): SelectedStrategy {
  let effectiveStrategy: ExtractionStrategy = baseStrategy;

  // ── Adaptive auto-selection ──
  if (baseStrategy === 'adaptive') {
    effectiveStrategy = autoSelectStrategy(model, taskType, codeSize, totalBudget);
  }

  const profile = STRATEGY_PROFILES[effectiveStrategy];
  const modelProfile = null; // caller can provide if needed

  // Apply task-type adjustments to the profile weights
  const taskAdj = TASK_ADJUSTMENTS[taskType] ?? TASK_ADJUSTMENTS.general;
  const adjustedBodyWeight = Math.min(1.0, Math.max(0.0, profile.symbolBodyWeight * taskAdj.symbolBody));
  const adjustedCommentWeight = Math.min(1.0, Math.max(0.0, profile.commentWeight * taskAdj.comment));
  const adjustedImportDensity = Math.min(1.0, Math.max(0.0, profile.importDensity * taskAdj.imports));

  // Budget allocation
  const adjustedProfile: StrategyProfile = {
    ...profile,
    symbolBodyWeight: adjustedBodyWeight,
    commentWeight: adjustedCommentWeight,
    importDensity: adjustedImportDensity,
    aggressiveMinify: taskAdj.minify === 1 && profile.aggressiveMinify,
  };

  const budget = allocateBudget(totalBudget, adjustedProfile, modelProfile);

  // Calculate importance threshold for body retention:
  // Top `symbolBodyWeight` fraction of symbols keep their bodies.
  // Convert to an approximate threshold (actual threshold applied later
  // after symbols are scored).
  const symbolBodyThreshold = 1.0 - adjustedBodyWeight;

  return {
    profile: adjustedProfile,
    budget,
    symbolBodyThreshold,
    minifyEnabled: adjustedProfile.aggressiveMinify,
    maxGraphDepth: adjustedProfile.graphDepth,
    importThreshold: adjustedImportDensity,
    keepComments: adjustedCommentWeight > 0.3,
    keepDocstrings: adjustedCommentWeight > 0.5,
  };
}

// ────────────────────────────────────────────────────────────
// AUTO-STRATEGY SELECTION
// ────────────────────────────────────────────────────────────

function autoSelectStrategy(
  model: Model,
  taskType: TaskType,
  codeSize: number,
  totalBudget: number,
): ExtractionStrategy {
  let score = 0;

  // Factor 1: Model context window
  const largeContextModels: Model[] = [
    'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
    'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
    'gpt-4-turbo',
  ];
  if (largeContextModels.includes(model)) score += 2; // Can handle more context
  else if (model === 'local' || model === 'gpt-4' || model === 'gpt-3.5-turbo') score -= 1; // Tight window

  // Factor 2: Task type
  const preservativeTasks: TaskType[] = ['code-review', 'feature-add', 'refactor'];
  const aggressiveTasks: TaskType[] = ['bug-fix', 'test-write'];

  if (preservativeTasks.includes(taskType)) score += 1;
  if (aggressiveTasks.includes(taskType)) score -= 1;

  // Factor 3: Code size vs budget pressure
  if (codeSize > 0 && totalBudget > 0) {
    const estimatedTokens = Math.ceil(codeSize / 3.5);
    const pressure = estimatedTokens / totalBudget;
    if (pressure > 3) score -= 2;      // Extreme pressure → aggressive
    else if (pressure > 1.5) score -= 1; // High pressure
    else if (pressure < 0.5) score += 1; // Relaxed
  }

  // Convert score to strategy
  if (score >= 2) return 'preservative';
  if (score >= 0) return 'balanced';
  if (score >= -1) return 'semantic';
  return 'aggressive';
}

// ────────────────────────────────────────────────────────────
// SYMBOL RANKING
// ────────────────────────────────────────────────────────────

export interface RankedSymbol extends Symbol {
  rank: number;
  rankFactors: {
    visibility: number;
    callFrequency: number;
    centrality: number;
    typeImportance: number;
    complexity: number;
    taskRelevance: number;
  };
  shouldKeepBody: boolean;
  reason: string;
}

const TYPE_IMPORTANCE: Record<string, number> = {
  class: 10,
  interface: 9,
  typeAlias: 8,
  enum: 8,
  module: 8,
  function: 7,
  method: 7,
  constructor: 7,
  constant: 5,
  variable: 4,
  property: 3,
  parameter: 1,
};

/**
 * Rank symbols by importance using multiple weighted factors.
 * Returns symbols sorted by rank descending.
 */
export function rankSymbols(
  symbols: Symbol[],
  strategy: SelectedStrategy,
  taskPrompt?: string,
  callGraphRanks?: Map<string, number>,
): RankedSymbol[] {
  const promptWords = taskPrompt
    ? taskPrompt.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    : [];

  return symbols
    .map(sym => {
      const visibilityScore = sym.isExported ? 1.0 : sym.visibility === 'public' ? 0.7 : 0.3;
      const typeImportance = (TYPE_IMPORTANCE[sym.type] ?? 5) / 10;
      const centrality = callGraphRanks?.get(sym.id) ?? 0;
      const complexityScore = Math.min(1.0, sym.complexity / 20);

      // Task relevance: does the prompt match this symbol?
      let taskRelevance = 0;
      if (promptWords.length > 0) {
        const symNameLower = sym.name.toLowerCase();
        const symBodyLower = sym.fullSource.toLowerCase();
        taskRelevance = promptWords.reduce((score, word) => {
          if (symNameLower.includes(word)) return score + 0.5;
          if (symBodyLower.includes(word)) return score + 0.1;
          return score;
        }, 0);
      }

      const weights = {
        visibility: 0.15,
        callFrequency: 0.10,
        centrality: 0.20,
        typeImportance: 0.20,
        complexity: 0.05,
        taskRelevance: 0.30,
      };

      const rankFactors = {
        visibility: visibilityScore * weights.visibility * 100,
        callFrequency: (sym.callCount / Math.max(1, sym.dependents.length + 1)) * weights.callFrequency * 100,
        centrality: centrality * weights.centrality * 100,
        typeImportance: typeImportance * weights.typeImportance * 100,
        complexity: complexityScore * weights.complexity * 100,
        taskRelevance: taskRelevance * weights.taskRelevance * 100,
      };

      const rank = Object.values(rankFactors).reduce((s, v) => s + v, 0);

      // Body retention decision
      const shouldKeepBody = rank / 100 >= strategy.symbolBodyThreshold;

      // One-line reason
      const topFactor = Object.entries(rankFactors)
        .sort(([, a], [, b]) => b - a)[0];
      const reason = topFactor
        ? `rank ${rank.toFixed(0)}/100 — ${topFactor[0]} dominant (${topFactor[1].toFixed(0)})`
        : `rank ${rank.toFixed(0)}/100`;

      return {
        ...sym,
        rank,
        rankFactors,
        shouldKeepBody,
        reason,
      };
    })
    .sort((a, b) => b.rank - a.rank);
}

/**
 * Apply strategy to filter/transform a ranked symbol list into final output content.
 */
export function applyStrategySelection(
  rankedSymbols: RankedSymbol[],
  _strategy: SelectedStrategy,
  totalBudget: number,
): {
  included: RankedSymbol[];
  excluded: RankedSymbol[];
  totalTokensUsed: number;
} {
  let budgetRemaining = totalBudget;
  const included: RankedSymbol[] = [];
  const excluded: RankedSymbol[] = [];

  for (const sym of rankedSymbols) {
    if (budgetRemaining <= 0) {
      excluded.push(sym);
      continue;
    }

    // Estimate tokens for this symbol
    const bodyTokensEstimate = Math.max(5, Math.ceil((sym.fullSource?.length ?? 0) / 3.5));
    const sigTokensEstimate = Math.max(2, Math.ceil((sym.signature?.length ?? 0) / 3.5));
    const cost = sym.shouldKeepBody ? bodyTokensEstimate : sigTokensEstimate;

    if (cost <= budgetRemaining) {
      included.push(sym);
      budgetRemaining -= cost;
    } else if (sigTokensEstimate <= budgetRemaining) {
      // Can't fit the body but can fit the signature
      included.push({ ...sym, shouldKeepBody: false });
      budgetRemaining -= sigTokensEstimate;
    } else {
      excluded.push(sym);
    }
  }

  return {
    included,
    excluded,
    totalTokensUsed: totalBudget - budgetRemaining,
  };
}
