# TokenWise Architecture

This document describes the internal architecture of the TokenWise core pipeline: stages, module responsibilities, data flow, and how strategies are selected.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TOKENWISE CORE PIPELINE                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌──────────────────┐
│  INPUT   │──▶│  PARSE   │──▶│  GRAPH BUILD │──▶│   PAGERANK       │
│  (code,  │   │ (tree-   │   │ (calls,      │   │ (iterative       │
│  options)│   │  sitter  │   │  imports,    │   │  centrality on   │
│          │   │ + regex) │   │  inheritance)│   │  directed graph) │
└──────────┘   └──────────┘   └──────────────┘   └────────┬─────────┘
                                                          │
                                                          ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  OUTPUT      │◀──│  SERIALIZE   │◀──│  SELECTION   │◀──│  STRATEGY      │
│  (Optimized  │   │ (imports +   │   │ (greedy fill │   │  SELECTION     │
│   Context)   │   │  sigs +      │   │  by rank     │   │  (adaptive or  │
│              │   │  bodies +    │   │  until       │   │   explicit)    │
│              │   │  docs)       │   │  budget)     │   │              │
└──────────────┘   └──────────────┘   └──────────────┘   └──────┬───────┘
                                                                 │
                    ┌────────────────────────────────────────────┘
                    ▼
         ┌──────────────────────┐
         │   RANKING            │
         │ (multi-factor score: │
         │  visibility + call   │
         │  freq + centrality   │
         │  + type importance   │
         │  + complexity +      │
         │  task relevance)     │
         └──────────────────────┘
```

---

## Module Responsibilities

### `src/types.ts` — Type System & Configuration
- **Zod schemas** for all enums: `Language`, `TokenEncoding`, `ExtractionStrategy`, `TaskType`, `Model`, `SymbolType`, `EdgeType`
- **Core interfaces**: `Symbol`, `SymbolGraph`, `OptimizationOptions`, `OptimizationResult`, `CodeChunk`, `StrategyProfile`, `ModelProfile`, `BudgetAllocation`, `SelectedStrategy`, `RankedSymbol`
- **Defaults**: `MODEL_PROFILES`, `DEFAULT_CONFIG`, `DEFAULT_ENCODING`, `DEFAULT_STRATEGY`
- **Diagnostics & metrics**: `Diagnostic`, `PerformanceMetrics`, `CacheOptions`

### `src/parser/index.ts` — Multi-Language Parsing
- **Language detection**: `detectLanguage(filePath)` → `Language` enum
- **Two-layer parser**:
  - **Layer 1**: Tree-sitter WASM (`web-tree-sitter`) — high-fidelity AST
  - **Layer 2**: Regex fallback per language — works everywhere, ~85% accuracy
- **Exports**: `parseCode` (async, tries tree-sitter), `parseCodeSync` (regex only), `detectLanguage`, `findRelevantSymbols`
- **Extracts**: `Symbol[]`, `ImportStatement[]`, `ExportStatement[]`, diagnostics

### `src/tokenizer/index.ts` — Token Counting
- **Primary**: `@dqbd/tiktoken` for accurate BPE (cl100k_base, p50k_base, r50k_base, o200k_base)
- **Fallback**: `CodeTokenEstimator` — calibrated character/token rules for code (~5% error vs BPE)
- **`Tokenizer` class**: LRU cache, `count()`, `countAsync()`, `estimate()`, `splitToFit()`, `getBudget()`
- **Convenience**: `countTokens()`, `estimateTokens()`, `estimateTokensFast()`, `tokensToChars()`, `formatTokenComparison()`, `splitToFit()`

### `src/graph/index.ts` — Symbol Dependency Graph
- **`buildGraph(symbols, options)`** → `SymbolGraph { nodes: Map<id, SymbolNode>, edges: SymbolEdge[] }`
- **Edge types**: `call` (name reference in source), `import` (cross-file), `inheritance` (extends/implements), `type`, `implementation`
- **PageRank**: 20 iterations, damping 0.85, handles dangling nodes
- **Clustering**: Connected-component BFS assignment
- **Depth from entry points**: Bidirectional BFS from named entry symbols
- **Queries**: `findShortestPath`, `findHotPath`, `findOrphanedSymbols`, `findEntryCandidates`, `getGraphStats`

### `src/strategies/index.ts` — Strategy Engine & Ranking
- **5 Strategy Profiles** (`STRATEGY_PROFILES`): `aggressive`, `balanced`, `preservative`, `semantic`, `adaptive`
  - Each defines: `symbolBodyWeight`, `commentWeight`, `importDensity`, `graphDepth`, `aggressiveMinify`
- **7 Task Types** (`TASK_ADJUSTMENTS`): multipliers applied to base profile weights
- **`selectStrategy(baseStrategy, model, taskType, totalBudget, codeSize, language)`** → `SelectedStrategy`
  - Adaptive auto-selection logic: model context window + task type + budget pressure → strategy
- **`allocateBudget(totalBudget, profile, modelProfile)`** → `BudgetAllocation`
  - Splits into: `criticalBudget`, `importantBudget`, `relevantBudget`, `dependencyBudget`, `documentationBudget`
- **`rankSymbols(symbols, strategy, taskPrompt, callGraphRanks)`** → `RankedSymbol[]` (sorted by rank desc)
  - Factors: `visibility` (15%), `callFrequency` (10%), `centrality` (20%), `typeImportance` (20%), `complexity` (5%), `taskRelevance` (30%)
  - `shouldKeepBody`: rank ≥ `symbolBodyThreshold` (1 - bodyWeight)
- **`applyStrategySelection(ranked, strategy, totalBudget)`** → `{ included, excluded, totalTokensUsed }`
  - Greedy fill: include full body if budget allows, else signature, else exclude

### `src/extractors/index.ts` — Main Pipeline Orchestration
- **`optimizeContext(code, options)`** — async, full pipeline with tree-sitter
  1. Resolve options & create tokenizer
  2. `parseCode()` → symbols
  3. `buildGraph()` + PageRank
  4. Determine budget from model limits
  5. `selectStrategy()`
  6. `rankSymbols()` with PageRank scores
  7. `applyStrategySelection()`
  8. `serializeSymbols()` → code + chunks
  9. Optional `compress()` if minify enabled
  10. Return `OptimizationResult`
- **`optimizeContextSync(code, options)`** — sync, regex parser only (no graph)
- **`compressContext(code, options)`** — compression-only mode
- **`extractDiff(original, modified)`** — changed symbols only
- **`optimizeMultiFile(files, options)`** — async batch
- **`optimizeMultiFileSync(files, options)`** — sync batch

### `src/compressors/index.ts` — Layered Compression
- **`compress(code, options, language)`** — configurable:
  - `removeComments`, `removeBlankLines`, `collapseWhitespace`, `minify`
  - `removeConsoleLogs`, `removeDebugCode`, `removeDeadCode`
  - `preserveShebang`, `preserveLicense`, `preserveImportantComments` (TODO/FIXME/etc)
- **`smartCompress()`** — balanced defaults
- **`compressFull()`** — returns `CompressionResult` with pattern breakdown
- **String protection**: Temporarily replaces string/template literals to avoid corrupting content

### `src/codebase/index.ts` — Codebase Walker
- **`analyzeCodebase(rootDir, options)`** → `CodebaseAnalysis`
  - Glob-based discovery (13 language extensions, skips node_modules/.git/dist/etc)
  - Parallel-ish parsing (sequential loop, configurable concurrency)
  - Cross-file import resolution via regex patterns
  - Global `SymbolGraph` with inter-file import edges
  - Entry-point detection: package.json main/module/exports + common entry files
- **`extractCodebaseContext(analysis, taskPrompt, targetTokens)`** → `{ context, relevantFiles, relevantSymbols, tokenCount }`
  - Scores symbols by prompt keyword match + export status + PageRank
  - Greedy budget fill across files

### `src/mcp/index.ts` — MCP Tool Definitions & Handlers
- **`TOOL_DEFINITIONS`**: 6 tools with JSON Schema inputs
- **`handleToolCall(toolName, args)`** → `McpToolResponse`
  - Routes to async handlers using dynamic imports (avoids circular deps)

### `src/mcp-server/index.ts` — Stdio MCP Server
- JSON-RPC 2.0 over stdin/stdout
- Implements `initialize`, `tools/list`, `tools/call`
- Handlers call core functions directly (no dynamic import needed)

---

## Data Flow Details

### Symbol Object Lifecycle

```
parseCode() → Symbol[] (raw, no graph edges)
       │
       ├─▶ buildGraph() → SymbolGraph { nodes: Map<id, SymbolNode>, edges[] }
       │     SymbolNode wraps Symbol + adds: centrality, fanIn, fanOut, clusterId, pageRank, depth
       │
       ├─▶ PageRank(iterations=20) → assigns pageRank to each node
       │
       ├─▶ rankSymbols() → RankedSymbol[] (adds: rank, rankFactors, shouldKeepBody, reason)
       │
       └─▶ applyStrategySelection() → { included: RankedSymbol[], excluded: RankedSymbol[] }
```

### Budget Flow

```
Model Profile (maxTokens, recommendedTokens)
         │
         ▼
targetTokens = options.targetTokens ?? model.recommendedTokens
         │
         ▼
allocateBudget(targetTokens, adjustedProfile, modelProfile)
         │
         ▼
BudgetAllocation { critical, important, relevant, dependency, documentation }
         │
         ▼
applyStrategySelection() uses budgets implicitly via token cost estimation
```

---

## Strategy Selection Logic

### Adaptive Auto-Selection (`autoSelectStrategy`)

```typescript
function autoSelectStrategy(model, taskType, codeSize, totalBudget): ExtractionStrategy {
  let score = 0;

  // Factor 1: Model context window
  if (largeContextModel(model)) score += 2;      // claude-3-*, gpt-4-turbo
  else if (tightWindowModel(model)) score -= 1;  // local, gpt-4, gpt-3.5

  // Factor 2: Task type
  if (preservativeTask(taskType)) score += 1;    // code-review, feature-add, refactor
  if (aggressiveTask(taskType)) score -= 1;      // bug-fix, test-write

  // Factor 3: Budget pressure (estimatedTokens / targetTokens)
  const pressure = estimatedTokens / totalBudget;
  if (pressure > 3) score -= 2;        // Extreme → aggressive
  else if (pressure > 1.5) score -= 1; // High
  else if (pressure < 0.5) score += 1; // Relaxed

  // Map score to strategy
  if (score >= 2) return 'preservative';
  if (score >= 0) return 'balanced';
  if (score >= -1) return 'semantic';
  return 'aggressive';
}
```

### Task-Type Adjustments (Applied to Base Profile)

| Task | Body | Comments | Imports | Minify |
|------|------|----------|---------|--------|
| bug-fix | 0.7× | 0.2× | 0.5× | ✅ |
| feature-add | 0.9× | 0.5× | 0.8× | ❌ |
| code-review | 1.0× | 0.8× | 0.9× | ❌ |
| refactor | 0.8× | 0.4× | 0.7× | ❌ |
| explain | 0.5× | 1.0× | 0.6× | ❌ |
| document | 0.4× | 1.0× | 0.5× | ❌ |
| test-write | 0.8× | 0.3× | 0.8× | ❌ |
| general | 1.0× | 0.5× | 0.8× | ❌ |

### Model Context Penalty Effect

In `allocateBudget()`:
```typescript
const contextPenaltyFactor = modelProfile
  ? 1.0 - (modelProfile.contextPenalty - 1) * 0.1
  : 1.0;

// penalty=1 (Claude Opus) → factor=1.0 → more budget to critical
// penalty=5 (local) → factor=0.6 → less to critical, more pressure
```

---

## Performance Characteristics

| Operation | Complexity | Typical Time (1k LOC) |
|-----------|------------|----------------------|
| Regex parse | O(n) | ~5–20ms |
| Tree-sitter parse | O(n) | ~50–200ms (first load) |
| Graph build | O(n²) symbol pairs | ~10–50ms |
| PageRank (20 iter) | O(iter × edges) | ~5–15ms |
| Ranking | O(n log n) sort | ~2–10ms |
| Serialization | O(n) | ~1–5ms |

**Total async pipeline**: ~50–300ms for typical files
**Sync pipeline**: ~10–50ms (no tree-sitter, no graph)

---

## Extension Points

1. **Custom Parser**: Implement `parseCode` / `parseCodeSync` returning `Symbol[]`
2. **Custom Strategy**: Add to `STRATEGY_PROFILES` and `TASK_ADJUSTMENTS`
3. **Custom Model Profile**: Extend `MODEL_PROFILES` in config
4. **Custom Compressor**: Use `compress()` with tailored `CompressionOptions`
5. **MCP Tools**: Add to `TOOL_DEFINITIONS` and handler in `handleToolCall`