# TokenWise API Reference

Complete reference for the public exports of **`@tokenwise/core`**.

---

## Installation

```bash
npm install @tokenwise/core
```

The package is ESM-only. All functions are tree-shakeable.

---

## Core Functions

The main entry points that run the full optimization pipeline:
**parse → symbol graph → strategy selection → rank → budget-aware serialization**

### `optimizeContext(code, options?)` — async

Full pipeline: parses code, builds a call graph, selects a strategy, ranks symbols by importance, and serializes the best subset to fit the token budget.

```ts
import { optimizeContext } from '@tokenwise/core';

const result = await optimizeContext(code, {
  language: 'typescript',
  strategy: 'adaptive',        // aggressive | balanced | preservative | semantic | adaptive
  taskType: 'bug-fix',         // task-aware weighting
  taskPrompt: 'fix the parse error in handleUserInput',  // semantic relevance
  targetTokens: 8000,
  model: 'claude-3-sonnet',    // model-aware budget profiling
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `code` | `string` | Source code to optimize (required) |
| `language` | `Language` | Auto-detected if omitted |
| `strategy` | `ExtractionStrategy` | Defaults to `adaptive` |
| `model` | `Model` | Target model for budget sizing |
| `taskType` | `TaskType` | `bug-fix`, `feature-add`, `code-review`, `refactor`, `explain`, `document`, `test-write`, `general` |
| `taskPrompt` | `string` | User's prompt — used for semantic symbol ranking |
| `targetTokens` | `number` | Soft token budget |
| `maxTokens` | `number` | Hard token cap |
| `includeBodies` / `includeSignatures` / `includeImports` / `includeDocumentation` | `boolean` | Include controls |
| `relevantSymbols` | `string[]` | Only include symbols matching these names |
| `encoding` | `TokenEncoding` | `cl100k_base` (default), `p50k_base`, `r50k_base`, `o200k_base` |

**Returns** `Promise<OptimizationResult>`:

```ts
{
  code: string;                 // optimized context
  chunks: CodeChunk[];
  originalTokens: number;
  optimizedTokens: number;
  reductionTokens: number;
  reductionPercent: number;
  compressionRatio: number;
  strategy: ExtractionStrategy;
  model: Model;
  encoding: TokenEncoding;
  processingTimeMs: number;
  taskType: TaskType;
  includedSymbols: string[];
  excludedSymbols: string[];
  totalSymbolsFound: number;
  language: Language;
  estimatedCompleteness: number;  // 0-100
  semanticCoverage: number;       // 0-100
  callGraphStats?: { totalNodes, totalEdges, maxDepth, clusters };
}
```

### `optimizeContextSync(code, options?)`

Synchronous variant — uses the regex parser (no tree-sitter/WASM). Same signature and return shape.

### `compressContext(code, options?)`

Strips comments, blank lines, and unnecessary whitespace. **Does not** extract symbols — pure text compression.

```ts
const result = compressContext(code, { language: 'typescript' });
```

### `extractDiff(original, modified, options?)`

Returns only the symbols that **changed** between two versions of a file. Perfect for PR reviews and incremental context.

```ts
const changes = extractDiff(originalCode, modifiedCode);
// changes.code contains only old() (modified) and newFunc() (added)
```

### `optimizeMultiFile(files, options?)` / `optimizeMultiFileSync`

Runs `optimizeContext` across an array of `{ path, code }` files, auto-detecting language per file. Returns an array of `OptimizationResult` with `filePath` populated.

---

## Parsing

### `parseCode(code, language, config?)` — async

Tries **tree-sitter** (WASM) first, falls back to regex extraction. Returns `ParserResult`:

```ts
{ symbols: Symbol[]; imports: ImportStatement[]; exports: ExportStatement[]; diagnostics: Diagnostic[]; parseTimeMs: number; treeSitterUsed: boolean; }
```

### `parseCodeSync(code, language)`

Regex-only sync parsing. Returns `Symbol[]`. Fast, works everywhere.

### `detectLanguage(filePath)`

Maps file extension → `Language` (`typescript`, `javascript`, `python`, `go`, `rust`, `java`, `cpp`, `c`, `ruby`, `php`, `csharp`, `swift`, `kotlin`). Defaults to `typescript`.

### `findRelevantSymbols(symbols, prompt)`

Basic keyword-matching relevance (substring scoring). For stronger results use the semantic module.

### `getLanguageDisplayName(language)` / `supportsTreeSitter(language)`

Helpers for display and capability checks.

---

## Tokenizer

### `Tokenizer` class

```ts
const t = new Tokenizer({ encoding: 'cl100k_base', maxCacheSize: 10000 });

t.count(code);            // number — with LRU caching
t.countAsync(code);       // Promise<number> — ensures tiktoken loaded
t.estimate(code);         // TokenEstimate — breakdown
t.splitToFit(code, max);  // string[] — line-aware chunking
t.getBudget(total);       // { header, symbols, dependencies, footer }
t.getStats();             // { size, maxSize, hits, misses, hitRate }
t.getEncodingInfo();      // { name, vocabSize }
t.clearCache();
```

Uses **@dqbd/tiktoken** (real BPE) when available, falls back to a calibrated character estimator.

### `CodeTokenEstimator`

Static estimator: `CodeTokenEstimator.estimate(code, encoding?)` — rule-based, ~5% of real BPE count.

### Functions

| Function | Description |
|----------|-------------|
| `countTokens(code, encoding?)` | Ad-hoc count (no cache) |
| `estimateTokens(code, encoding?)` | Full `TokenEstimate` breakdown |
| `estimateTokensFast(code, encoding?)` | Chars-per-token ratio (~15% error, very fast) |
| `splitToFit(code, maxTokens, encoding?)` | Chunk to fit budget |
| `tokensToChars(tokens)` | `tokens * 3.5` |
| `formatTokenComparison(orig, opt)` | `"tokens: 100 → 30 (saved 70, 70.0%)"` |
| `defaultTokenizer` | Shared module-level instance |

`TokenEstimate`:
```ts
{ tokens, characters, words, lines, codeTokens, commentTokens, stringTokens, whitespaceTokens }
```

---

## Symbol Graph

### `buildGraph(symbols, options?)`

Builds a directed dependency graph (call/import/inheritance/type edges) with PageRank centrality, cluster detection, and entry-point depth.

```ts
const graph = buildGraph(symbols, {
  maxDepth: 5,
  includeImports: true,
  includeInheritance: true,
  entryPoints: ['main'],
  ignorePattern: /^_/,
});
// { nodes: Map<string, SymbolNode>, edges: SymbolEdge[] }
```

`SymbolNode`: `{ id, symbol, centrality, fanIn, fanOut, clusterId, pageRank, depth }`

### `getGraphStats(graph)`

```ts
{ totalNodes, totalEdges, clusters, edgeTypes, avgPageRank }
```

### `findHotPath(graph)`

Walks the highest-weighted path from the most central node → `string[]` of symbol names.

### `findShortestPath(graph, fromName, toName)`

BFS shortest path → `GraphQueryResult[]` with `{ path, totalWeight, depth }`.

### `findOrphanedSymbols(graph)` / `findEntryCandidates(graph)`

Isolated nodes / exported symbols with no incoming edges (entry candidates).

---

## Strategy Engine

### `selectStrategy(baseStrategy, model, taskType?, totalBudget?, codeSize?, language?)`

Selects and configures the effective strategy. For `adaptive`, auto-selects from model context penalty + task type + budget pressure.

```ts
const s = selectStrategy('adaptive', 'claude-3-sonnet', 'bug-fix', 8000, code.length);
// s.profile, s.budget, s.symbolBodyThreshold, s.minifyEnabled, s.maxGraphDepth
```

### `rankSymbols(symbols, strategy, taskPrompt?, callGraphRanks?)`

Ranks symbols by weighted importance (visibility, call frequency, centrality, type, complexity, task relevance). Returns `RankedSymbol[]` with `rank`, `rankFactors`, `reason`, `shouldKeepBody`.

### `applyStrategySelection(rankedSymbols, strategy, totalBudget)`

Greedy budget-fill: keeps bodies for high-rank symbols, signatures for the rest. Returns `{ included, excluded, totalTokensUsed }`.

### `allocateBudget(totalBudget, strategy, modelProfile?)`

Splits budget: critical / important / relevant / dependency / documentation.

### `STRATEGY_PROFILES`

`{ aggressive, balanced, preservative, semantic, adaptive }` — each with `symbolBodyWeight`, `commentWeight`, `importDensity`, `graphDepth`, `aggressiveMinify`.

---

## Codebase Analysis

### `analyzeCodebase(rootDir, options?)`

Walks a directory, parses every source file, builds a **cross-file** symbol graph with import resolution and entry-point detection.

```ts
const analysis = analyzeCodebase('./src', {
  include: ['**/*.ts', '**/*.py'],
  maxFiles: 500,
  maxFileSize: 1_000_000,
  skipCommonDirs: true,
  detectEntryPoints: true,
});
```

**Returns** `CodebaseAnalysis`:
```ts
{ files: CodebaseFile[]; totalFiles; parsedFiles; totalLines; totalTokens;
  symbols: Symbol[]; globalGraph: SymbolGraph; entryPoints: string[];
  stats: { languages, totalSymbols, graphNodes, graphEdges, clusters, processingTimeMs } }
```

### `extractCodebaseContext(analysis, taskPrompt, targetTokens)`

Selects the most relevant symbols across the codebase and serializes them to fit the budget.

```ts
const ctx = await extractCodebaseContext(analysis, 'how does auth work?', 8000);
// { context, relevantFiles, relevantSymbols, tokenCount }
```

---

## Semantic Relevance (TF-IDF)

Ranks symbols by semantic similarity to a natural-language prompt — beyond keyword matching.

### `createSemanticIndex(symbols)`

Builds a `SemanticIndex` (`{ symbols, docs, idf }`). Each symbol's document = name (terms ×3) + signature + first 500 chars of body.

### `scoreSymbols(index, prompt)`

Returns `SymbolScore[]` (`{ symbol, score }`) sorted descending. Empty prompt → all zeros, original order preserved.

### `rankBySemantics(symbols, prompt)`

One-shot: `createSemanticIndex` + `scoreSymbols` → `Symbol[]` sorted by relevance.

### `findRelatedSymbols(index, symbolId, topN?)`

Most similar symbols to a seed — answers "what else touches this?"

### Primitives

`tokenizeText(text)` (stopword-filtered), `termFrequency(tokens)`, `inverseDocumentFrequency(docs)`, `cosineSimilarity(vecA, vecB)`.

---

## Budget Visualization

### `visualizeBudget(result)`

Breaks an `OptimizationResult` into `BudgetBreakdown`:
```ts
{ total, header, imports, symbols, dependencies, overhead, perSymbol, reduction }
```
Per-symbol: `{ name, type, tokens, pct, hasBody }`.

### `formatBudgetText(result)`

ASCII bar chart:
```
symbols   ████████████ 78.4% (1,203 tok)
imports   ████ 15.2% (233 tok)
overhead  ██ 6.4% (98 tok)
```

### `formatBudgetJSON(result)`

JSON string of the breakdown.

### `estimateSavings(code, language?)`

Pre-optimization estimate: `{ originalTokens, charsPerToken, estimatedOptimizedTokens, savingsPercent }`.

### `Visualizer` class

Static wrappers: `Visualizer.budget(result)`, `Visualizer.text(result)`, `Visualizer.json(result)`, `Visualizer.savings(code)`.

---

## Context Restoration

Reversible compression — map optimized output back to original symbols (code-aware version of Headroom's CCR).

### `createRestoreMap(originalSymbols, optimizedResult)`

Returns `RestoreMap`: `{ entries, bySymbol }` where entries link chunk IDs → original symbol sources.

### `createRestoreMapFromCode(code, optimizedResult, language?)`

Convenience: parses `code` first, then creates the map.

### `restoreSymbol(restoreMap, symbolName)`

Full original source for one symbol.

### `restoreChunk(restoreMap, chunkId)`

All original sources for a chunk.

### `getOriginalSourcesForChunk(restoreMap, chunkId)`

Same as `restoreChunk` but returns `string[]` (raw list).

### `formatRestoreMap(restoreMap)`

Human-readable instructions listing what was compressed and how to restore each piece.

### `Restore` class

Static wrappers: `Restore.create(symbols, result)`, `Restore.fromCode(code, result, lang?)`, `Restore.symbol(map, name)`, `Restore.chunk(map, chunkId)`.

---

## MCP Server

### `handleToolCall(toolName, args)`

Dispatches an MCP tool call. Returns `McpToolResponse` (`{ content: [{ type: 'text', text }], isError }`).

### `TOOL_DEFINITIONS`

Array of `McpToolDefinition` (`{ name, description, inputSchema }`) for the 6 tools:
`optimize_context`, `compress_code`, `count_tokens`, `extract_diff`, `parse_code`, `analyze_context`.

### Running the server

```bash
npx tokenwise-mcp
```

Serves JSON-RPC 2.0 over stdio. Add to Claude Code / Cursor as an MCP server with command `npx tokenwise-mcp`.

---

## Key Interfaces

### `OptimizationOptions`

Full option surface — see the `optimizeContext` table above plus:
`focusFiles`, `ignoreSymbols`, `analyzeCallGraph`, `callGraphDepth`, `prioritizeHotPaths`, `enableCaching`, `maxProcessingTimeMs`, `enableParallelProcessing`, `minCompleteness`, `outputFormat`.

### `OptimizationResult`

See `optimizeContext` return shape above.

### `Symbol`

```ts
{
  id, name, type, filePath, range: Range, startLine, endLine,
  signature, fullSource, documentation?,
  visibility: 'public'|'private'|'protected'|'internal',
  isExported, isAsync, isGenerator,
  dependencies: string[], dependents: string[], importStatements: string[],
  importanceScore, callCount, lineCount, complexity, parameters: Parameter[],
  parent?, children: string[],
}
```

### `CodebaseAnalysis`

See `analyzeCodebase` return shape above.

### `SemanticIndex`

```ts
{ symbols: Symbol[]; docs: Map<string, Map<string, number>>; idf: Map<string, number> }
```

### `RestoreMap`

```ts
{ entries: RestoreEntry[]; bySymbol: Map<string, string> }
```

---

## Language & Model Types

```ts
type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java'
              | 'cpp' | 'c' | 'ruby' | 'php' | 'csharp' | 'swift' | 'kotlin';

type TokenEncoding = 'cl100k_base' | 'p50k_base' | 'r50k_base' | 'o200k_base';

type ExtractionStrategy = 'aggressive' | 'balanced' | 'preservative' | 'semantic' | 'adaptive';

type TaskType = 'bug-fix' | 'feature-add' | 'code-review' | 'refactor'
              | 'explain' | 'document' | 'test-write' | 'general';
```

`MODEL_PROFILES` (in `types.ts`) covers Claude 3/4, GPT-4/4-Turbo/3.5, Gemini, and local — each with `maxTokens`, `recommendedTokens`, `encoding`, `contextPenalty`, `recommendedStrategy`.
