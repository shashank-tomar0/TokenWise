# TokenWise Strategies

This document describes the extraction strategies and model profiles in TokenWise. It is a companion to the [architecture guide](./architecture.md). All weights and values below are taken directly from `packages/core/src/strategies/index.ts` and `packages/core/src/types.ts`.

---

## Overview

A strategy tells TokenWise **what to keep and what to strip** from a codebase when building a token-optimized context. The engine compresses three dimensions:

- **Symbol bodies** — the full source of a function/class/interface (vs. keeping only its signature)
- **Comments & documentation** — JSDoc/docstrings and inline comments
- **Imports** — which import statements survive distillation

Strategy selection is a convergence of four inputs:

1. **Model context penalty** — how much the target model tolerates long context (`contextPenalty`, 1–5).
2. **Task type** — what you are trying to do (bug-fix vs. document keep very different things).
3. **Budget pressure** — estimated code size vs. available token budget.
4. **Explicit choice** — the caller may force a strategy, or pass `'adaptive'` to auto-select.

When `baseStrategy === 'adaptive'`, `selectStrategy` runs `autoSelectStrategy(model, taskType, codeSize, totalBudget)` and then applies task-type adjustments to the winning profile. Every strategy weight is a **multiplier** — the task adjustment is multiplied into the base profile value and clamped to `[0, 1]`.

The higher the model's `contextPenalty`, the more budget shifts toward critical symbols (see [Budget Allocation](#budget-allocation)).

---

## The 5 Strategies

Profiles are defined in `STRATEGY_PROFILES`. Fields and their meaning:

| Field | Meaning |
|---|---|
| `symbolBodyWeight` | 0–1.0, fraction of symbols that keep full bodies |
| `commentWeight` | 0–1.0, how many docs/comments to keep |
| `importDensity` | 0–1.0, fraction of imports to include |
| `graphDepth` | Max call-graph depth to traverse |
| `aggressiveMinify` | Whether aggressive minification is applied |

### aggressive

- **Description:** Maximum compression — signatures only for non-critical symbols, aggressive minification.
- **When to use it:** Tight context budgets, low-capacity models (`gpt-4`, `gpt-3.5-turbo`, `local`), or large-but-low-priority codebases where you only need the shape of the code.
- **Actual profile weights:**
  - `symbolBodyWeight: 0.1` — only the top 10% of symbols keep bodies
  - `commentWeight: 0.0` — all comments stripped
  - `importDensity: 0.3` — keep only direct imports
  - `graphDepth: 1` — only immediate callees
  - `aggressiveMinify: true`

### balanced

- **Description:** Moderate compression — full bodies for high-importance symbols, signatures for the rest.
- **When to use it:** The default choice. Good for mid-range models and most day-to-day tasks where you need real bodies of the important symbols without bloating the window.
- **Actual profile weights:**
  - `symbolBodyWeight: 0.4` — bodies for the top 40%
  - `commentWeight: 0.2` — keep JSDoc/docstrings
  - `importDensity: 0.6` — keep most imports
  - `graphDepth: 2` — two layers of deps
  - `aggressiveMinify: false`

### preservative

- **Description:** Minimal compression — keep most context, good for large-context models.
- **When to use it:** Models with big context windows and low penalty (e.g. `claude-3-opus`, `claude-opus-4`), or tasks like code-review/feature-add where losing context is risky.
- **Actual profile weights:**
  - `symbolBodyWeight: 0.8` — bodies for the top 80%
  - `commentWeight: 0.7` — keep most docs
  - `importDensity: 0.9` — keep nearly all imports
  - `graphDepth: 3` — three layers deep
  - `aggressiveMinify: false`

### semantic

- **Description:** Importance-driven — keep only what matters based on call-graph centrality and relevance scoring.
- **When to use it:** Large codebases where a lot of the surface area is dead weight. Recommended under moderate budget pressure. It pairs with `rankSymbols()` to let component-scored importance drive retention.
- **Actual profile weights:**
  - `symbolBodyWeight: 0.3` — bodies for high-scored symbols only
  - `commentWeight: 0.1` — strip all but critical docs
  - `importDensity: 0.5` — smart import selection
  - `graphDepth: 2`
  - `aggressiveMinify: false`

### adaptive

- **Description:** Auto-selects the best strategy based on model, code size, and task context.
- **When to use it:** Always a safe default — let TokenWise decide. It runs `autoSelectStrategy()` and then applies the task adjustment on top. Its own weights are a starting point that is typically overwritten once a concrete model/task/code size is known.
- **Actual profile weights:**
  - `symbolBodyWeight: 0.4`
  - `commentWeight: 0.3`
  - `importDensity: 0.6`
  - `graphDepth: 2`
  - `aggressiveMinify: false` — determined dynamically (`taskAdj.minify === 1 && profile.aggressiveMinify`)

### How adaptive auto-selects

`autoSelectStrategy(model, taskType, codeSize, totalBudget)` computes a score:

| Factor | Effect |
|---|---|
| **Model context** | +2 for `largeContextModels` (`claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`, `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`, `gpt-4-turbo`); **−1** for `local`, `gpt-4`, `gpt-3.5-turbo` |
| **Task type** | +1 for `code-review`/`feature-add`/`refactor`; **−1** for `bug-fix`/`test-write` |
| **Budget pressure** | `estimatedTokens = ceil(codeSize / 3.5)`; `pressure = estimatedTokens / totalBudget`; **−2** if `pressure > 3`, **−1** if `> 1.5`, **+1** if `< 0.5` |

Score → strategy: `score >= 2` → `preservative`, `>= 0` → `balanced`, `>= -1` → `semantic`, else `aggressive`.

**Example:** bug-fix on `local` (tight window) under extreme pressure = `0 − 1 − 1 − 2` → picks `aggressive`. A code-review on `claude-3-opus` with a relaxed budget = `0 + 2 + 1 + 1` → `preservative`.

---

## Task-Type Profiles

The 8 task types live in `TASK_ADJUSTMENTS`. Each supplies **multipliers** that are applied to a strategy's base weights (`1.0` = no change). Values > 1 keep more of that thing; < 1 strip more. The resulting weights are clamped to `[0, 1]` in `selectStrategy`.

| Task | `symbolBody` | `comment` | `imports` | `minify` | Note |
|---|---|---|---|---|---|
| `bug-fix` | 0.7 | 0.2 | 0.5 | **1** | Strip docs, keep structure |
| `feature-add` | 0.9 | 0.5 | 0.8 | 0 | Need full context |
| `code-review` | 1.0 | 0.8 | 0.9 | 0 | Need everything |
| `refactor` | 0.8 | 0.4 | 0.7 | 0 | Moderate |
| `explain` | 0.5 | 1.0 | 0.6 | 0 | Keep docs |
| `document` | 0.4 | 1.0 | 0.5 | 0 | Docs matter most |
| `test-write` | 0.8 | 0.3 | 0.8 | 0 | Structure + imports |
| `general` | 1.0 | 0.5 | 0.8 | 0 | — |

**How to read it:** `bug-fix` sets `minify: 1`, so even a non-minifying base profile (e.g. `balanced`) becomes minified; it also cuts bodies to 70%, comments to 20%, and imports to 50% of whatever the active strategy allows. `explain` and `document` keep 100% of comments (multiplier 1.0) because documentation is the deliverable.

`minify` is `0` (disabled) or `1` (enabled); the final `aggressiveMinify` only flips on when `task.minify === 1 && profile.aggressiveMinify` (so e.g. `balanced` + `bug-fix` → minify on, but `aggressive` + `explain` stays minify on since profile is already `true`).

**Derived flags from the adjusted comment weight** (in `selectStrategy`):

- `keepComments = adjustedCommentWeight > 0.3`
- `keepDocstrings = adjustedCommentWeight > 0.5`

---

## Model Profiles

Defined in `MODEL_PROFILES` in `packages/core/src/types.ts`. All models use `cl100k_base` encoding except `gpt-4-turbo` which uses `o200k_base`.

| Model | `maxTokens` | `recommendedTokens` | `encoding` | `contextPenalty` | `recommendedStrategy` |
|---|---|---|---|---|---|
| `claude-3-opus` | 200,000 | 180,000 | `cl100k_base` | 1 | `preservative` |
| `claude-3-sonnet` | 200,000 | 150,000 | `cl100k_base` | 2 | `balanced` |
| `claude-3-haiku` | 200,000 | 150,000 | `cl100k_base` | 2 | `balanced` |
| `claude-opus-4` | 200,000 | 180,000 | `cl100k_base` | 1 | `preservative` |
| `claude-sonnet-4` | 200,000 | 150,000 | `cl100k_base` | 2 | `balanced` |
| `claude-haiku-4` | 200,000 | 150,000 | `cl100k_base` | 2 | `balanced` |
| `gpt-4-turbo` | 128,000 | 100,000 | `o200k_base` | 2 | `balanced` |
| `gpt-4` | 8,192 | 6,000 | `cl100k_base` | 4 | `aggressive` |
| `gpt-3.5-turbo` | 16,385 | 12,000 | `cl100k_base` | 4 | `aggressive` |
| `gemini-pro` | 30,720 | 25,000 | `cl100k_base` | 3 | `balanced` |
| `local` | 8,192 | 4,000 | `cl100k_base` | 5 | `aggressive` |

`contextPenalty` (1–5) encodes "how well the model handles long context": **1** means "use the full window"; **5** means "keep it short". Note the asymmetry — the three newest Claude variants all report the same 200K window, so `contextPenalty` is what distinguishes them for budget purposes. Defaults: `DEFAULT_MODEL = 'claude-3-sonnet'`, `contextPenalty` default strategy `DEFAULT_STRATEGY = 'adaptive'`.

---

## Budget Allocation

`allocateBudget(totalBudget, strategy, modelProfile)` splits the token budget into five categories and returns a `BudgetAllocation`. The formula (`packages/core/src/strategies/index.ts`):

```
contextPenaltyFactor = modelProfile
  ? 1.0 - (contextPenalty - 1) * 0.1
  : 1.0

baseCritical      = 0.25 * contextPenaltyFactor
baseImportant     = 0.35 * contextPenaltyFactor
baseDependencies  = 0.15
baseDocumentation = 0.05 * strategy.commentWeight
remaining         = 1 - baseCritical - baseImportant - baseDependencies - baseDocumentation

criticalBudget      = floor(totalBudget * baseCritical)
importantBudget     = floor(totalBudget * baseImportant)
relevantBudget      = floor(totalBudget * remaining)
dependencyBudget    = floor(totalBudget * baseDependencies)
documentationBudget = floor(totalBudget * baseDocumentation)
```

Key behaviors:

- **Critical and important budgets scale with model penalty.** The higher the `contextPenalty`, the smaller `contextPenaltyFactor` (e.g. `local` at penalty 5 → `1 − 4*0.1 = 0.6`), which pulls tokens **out** of critical/important and lets the leftover (`relevantBudget`) absorb them — you keep more low-priority signatures, safer for tight-window models.

  Worked examples for `critical`/`important` (of a 10,000-token budget):
  - penalty 1 (`claude-3-opus`): `factor = 1.0` → critical `2,500`, important `3,500`
  - penalty 2 (`claude-3-sonnet`, most models): `factor = 0.9` → critical `2,250`, important `3,150`
  - penalty 5 (`local`): `factor = 0.6` → critical `1,500`, important `2,100`

- **Documentation budget scales with `commentWeight`** (`0.05 * commentWeight`), so `aggressive` (weight 0.0) gets **zero** docs budget while `preservative` (weight 0.7) gets `0.035` of the total.
- **`relevantBudget` is the residual** — whatever is left after critical + important + dependencies + documentation — so it absorbs all compression under pressure and is the largest bucket in most configurations (typically ~0.2–0.3 for low-penalty models).

The `remaining` value funds what `rankSymbols`/`applyStrategySelection` feed into the greedy fill, where each symbol costs an estimated body (`ceil(bodyLength / 3.5)`) or signature (`ceil(sigLength / 3.5)`) token count.

---

## Choosing a Strategy

**Let `adaptive` decide when:**
- You don't know the codebase ahead of time or the call is generic.
- The model + task + budget combo is the "normal" case (e.g. `claude-sonnet-4` + `general`).
- You want predictable resilience: adaptive bounces between `preservative`/`balanced`/`semantic`/`aggressive` automatically as budget pressure changes.

**Override with an explicit strategy when:**
- You have a **fixed, known model** and want certainty. For example, hard-code `preservative` for `claude-opus-4` work streams, or `aggressive` for a `local`-flavored pipeline.
- The auto-score is wrong for your case. Adaptive values the "keep docs" direction only through task multipliers; if you need docs preserved for a body-focused task, override.
- You're embedding TokenWise in a tool that is **task-of-specific-purpose** (e.g. an always-`bug-fix` integration) — pin the strategy and skip the auto-score on every call.
- You need total determinism for tests/golden files.

**A note on `semantic` vs `balanced`:** adaptive returns `semantic` only under the narrow `-1 ≤ score < 0` band. If your codebase is large and you rely on call-graph relevance, often explicit `semantic` beats adaptive for batch jobs even when the score predicts `balanced`.

---

## Code Examples

The strategy engine is exported from the `@tokenwise/core` package:

```ts
import {
  selectStrategy,
  STRATEGY_PROFILES,
  rankSymbols,
  allocateBudget,
  type SelectedStrategy,
  type BudgetAllocation,
} from '@tokenwise/core';

// 1. Let adaptive pick for a small, tight-window model
const selected: SelectedStrategy = selectStrategy(
  'adaptive',              // auto-select
  'gpt-3.5-turbo',         // model → context penalty 4
  'bug-fix',               // task type → minify on, strip docs
  12000,                   // token budget (recommended for gpt-3.5-turbo)
  48000,                   // code size in characters → pressure ≈ 48000/3.5/12000 ≈ 1.14
);

console.log(selected.profile.name);        // 'aggressive' (tight window + bug-fix)
console.log(selected.minifyEnabled);       // true
console.log(selected.symbolBodyThreshold); // 1 - symbolBodyWeight * 0.7 (clamped)


// 2. Force a strategy explicitly, no budget pressure
const review: SelectedStrategy = selectStrategy('preservative', 'claude-3-opus', 'code-review', 180_000, 200_000);
console.log(review.keepComments);          // preservative keeps docs → true
console.log(review.keepDocstrings);        // true

// 3. Budget split without a model (pass null for modelProfile)
const budget: BudgetAllocation = allocateBudget(10_000, STRATEGY_PROFILES.balanced, null);
// critical 2500, important 3500, dependencies 1500, documentation 100 (0.05*0.2*10000)


// 4. Rank symbols, then keep only those whose rank clears the threshold
const ranked = rankSymbols(symbols, selected, 'fix an off-by-one in the paginator');
for (const sym of ranked) {
  if (sym.shouldKeepBody) { /* include sym.fullSource */ }
  else { /* include sym.signature only */ }
}
```

Notes for the examples:

- In example 1, `selectStrategy` computes `adjustedBodyWeight = clamp(profile.symbolBodyWeight * taskAdj.symbolBody)`. Because the aggressive profile's body weight is `0.1` and `bug-fix` multiplies by `0.7`, the effective threshold becomes `1 − 0.07 = 0.93` — only the top ~7% keep bodies.
- `STRATEGY_PROFILES` is a plain object you can pass to `allocateBudget` directly, so you can budget without going through a `selected` config.
- `rankSymbols` weights its factors as `visibility 0.15`, `callFrequency 0.10`, `centrality 0.20`, `typeImportance 0.20`, `complexity 0.05`, `taskRelevance 0.30`; the top factor becomes the one-line `reason` on each `RankedSymbol`.

---

That completes the strategy and model profiling guide. See `packages/core/src/index.ts` for the full public API surface of the strategy engine.