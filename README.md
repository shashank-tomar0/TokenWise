# TokenWise — Symbol-Aware Context Distillation for AI Coding Assistants

[![npm](https://img.shields.io/npm/v/@tokenwise/core?label=@tokenwise/core)](https://www.npmjs.com/package/@tokenwise/core)
[![build](https://img.shields.io/github/actions/workflow/status/tokenwise/tokenwise/ci.yml?branch=main&label=build)](https://github.com/tokenwise/tokenwise/actions)
[![tests](https://img.shields.io/github/actions/workflow/status/tokenwise/tokenwise/ci.yml?branch=main&label=tests)](https://github.com/tokenwise/tokenwise/actions)
[![license](https://img.shields.io/npm/l/@tokenwise/core)](https://github.com/tokenwise/tokenwise/blob/main/LICENSE)

---

**TokenWise** reduces the token cost of sending code to LLMs by 50–80% while preserving the symbols that matter for your task. It parses code into a symbol graph, ranks by call-graph centrality and task relevance, then emits a budget-aware context.

## What It Does

```
Input code  →  Parse (tree-sitter + regex)  →  Build call graph + PageRank
    │                                                          │
    └─▶ Select strategy (adaptive or explicit) ───────────────┘
                        │
                        ▼
            Rank symbols by:
              • Visibility (exported/public)
              • Call frequency & PageRank centrality
              • Type importance (class > function > variable)
              • Cyclomatic complexity
              • Task prompt relevance (TF-IDF semantic match)
                        │
                        ▼
            Greedy fill until token budget exhausted
                        │
                        ▼
            Serialize: imports + signatures + selected bodies + docs
                        │
                        ▼
            Output: optimized context + chunk metadata + token stats
```

## Features

| Capability | Description |
|------------|-------------|
| **13-language parser** | Tree-sitter WASM for TS/JS/Python/Go/Rust/Java/C++/C/Ruby/PHP/C#/Swift/Kotlin, with zero-dependency regex fallback |
| **Real BPE tokenization** | `@dqbd/tiktoken` (cl100k_base, p50k_base, r50k_base, o200k_base) + calibrated estimator fallback |
| **Call-graph analysis** | Builds directed graph (calls, imports, inheritance), runs PageRank (20 iterations), finds hot paths & orphaned symbols |
| **5 extraction strategies** | `aggressive` / `balanced` / `preservative` / `semantic` / `adaptive` (auto-selects) |
| **7 task-type profiles** | `bug-fix`, `feature-add`, `code-review`, `refactor`, `explain`, `document`, `test-write` — each adjusts weights |
| **Model profiles** | 11 models with context windows, recommended budgets, and default strategies |
| **TF-IDF semantic ranking** | `tokenizeText`, `termFrequency`, `inverseDocumentFrequency`, `cosineSimilarity`, `createSemanticIndex`, `scoreSymbols`, `rankBySemantics`, `findRelatedSymbols` |
| **Budget visualizer** | `visualizeBudget`, `formatBudgetText` (ASCII bars), `formatBudgetJSON`, `estimateSavings` |
| **Context restoration map** | *(planned)* — `createRestoreMap`, `restoreSymbol`, `restoreChunk`, `formatRestoreMap` |
| **MCP server (6 tools)** | `optimize_context`, `compress_code`, `count_tokens`, `extract_diff`, `parse_code`, `analyze_context` — runs via `npx tokenwise-mcp` |
| **Codebase walker** | `analyzeCodebase`, `extractCodebaseContext` — multi-file scan, cross-file import graph, entry-point detection |
| **GitHub Action** | `tokenwise/action` — PR comment with token reduction report |

## Quick Start

```bash
npm install @tokenwise/core
```

```ts
import {
  optimizeContext,
  optimizeContextSync,
  countTokens,
  parseCodeSync,
  // Core pipeline
  buildGraph,
  rankSymbols,
  selectStrategy,
  // Types
  type OptimizationOptions,
  type OptimizationResult,
  type Symbol,
  type Language,
  type Model,
  type ExtractionStrategy,
  type TaskType,
  // Tokenizer
  Tokenizer,
  CodeTokenEstimator,
  estimateTokens,
  splitToFit,
  // Compression
  compress,
  smartCompress,
  compressFull,
  // Codebase
  analyzeCodebase,
  extractCodebaseContext,
  // MCP
  handleToolCall,
  TOOL_DEFINITIONS,
} from '@tokenwise/core';

// Optional subpath imports (tree-shakeable)
import {
  tokenizeText,
  termFrequency,
  inverseDocumentFrequency,
  cosineSimilarity,
  createSemanticIndex,
  scoreSymbols,
  rankBySemantics,
  findRelatedSymbols,
  type SemanticIndex,
  type SymbolScore,
} from '@tokenwise/core/semantic';

import {
  visualizeBudget,
  formatBudgetText,
  formatBudgetJSON,
  estimateSavings,
  type BudgetBreakdown,
  type SavingsEstimate,
  Visualizer,
} from '@tokenwise/core/visualize';

import {
  createRestoreMap,
  restoreSymbol,
  restoreChunk,
  formatRestoreMap,
  type RestoreMap,
} from '@tokenwise/core/restore';
```

### Basic optimization

```ts
const code = await fs.readFile('src/utils.ts', 'utf-8');

// Async (uses tree-sitter if available, builds call graph)
const result = await optimizeContext(code, {
  model: 'claude-3-sonnet',
  taskType: 'bug-fix',
  taskPrompt: 'Fix the race condition in ConnectionPool',
  strategy: 'adaptive', // auto-selects
});

// Sync (regex parser only, no graph — faster, less accurate)
const quick = optimizeContextSync(code, {
  model: 'gpt-4',
  strategy: 'balanced',
});

console.log(`Reduced ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.reductionPercent}%)`);
console.log(result.code); // Send this to the LLM
```

### Budget visualization

```ts
const result = await optimizeContext(code, { model: 'claude-3-sonnet' });

// ASCII bar chart
console.log(formatBudgetText(result));
// symbols   ████████████ 78.4% (1,203 tok)
// imports   ████ 15.2% (233 tok)
// overhead  ██ 6.4% (98 tok)
// 
// total        1,534 tokens
// reduction    62.3%
//
// Top symbols by tokens:
//   ConnectionPool           1,203 tok (42.3%) ●
//   acquireConnection          312 tok (11.0%) ○
//   releaseConnection          287 tok (10.1%) ○
```

### Semantic relevance (TF-IDF)

```ts
import { createSemanticIndex, scoreSymbols } from '@tokenwise/core/semantic';
import { parseCodeSync } from '@tokenwise/core';

const symbols = parseCodeSync(code, 'typescript');
const index = createSemanticIndex(symbols);

// Rank by relevance to a natural-language prompt
const scored = scoreSymbols(index, 'How does the connection pool handle timeouts?');
// [{ symbol: Symbol, score: 0.87 }, ...]
```

### Token counting

```ts
import { Tokenizer, countTokens, estimateTokens, splitToFit } from '@tokenwise/core';

const tokenizer = new Tokenizer({ encoding: 'cl100k_base' });
const tokens = tokenizer.count(code);           // exact BPE count
const fast = countTokens(code);                 // convenience (cl100k_base)
const { tokens: est, chars, words, lines } = estimateTokens(code); // fast estimator
const chunks = splitToFit(code, 8000);          // split to fit a context window
```

### Codebase-wide context

```ts
import { analyzeCodebase, extractCodebaseContext } from '@tokenwise/core';

const analysis = analyzeCodebase('./my-project', {
  maxFiles: 200,
  detectEntryPoints: true,
});

const { context, tokenCount, relevantFiles, relevantSymbols } =
  await extractCodebaseContext(analysis, 'Add retry logic to HTTP client', 50_000);
```

## MCP Server

The MCP server exposes 6 tools over stdio (JSON-RPC 2.0).

```bash
# Run directly
npx tokenwise-mcp

# Or with config for Claude Code / Cursor
```

**Claude Code (`~/.claude/claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "tokenwise": {
      "command": "npx",
      "args": ["tokenwise-mcp"],
      "env": {}
    }
  }
}
```

**Cursor (`.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "tokenwise": {
      "command": "npx",
      "args": ["tokenwise-mcp"]
    }
  }
}
```

**Available tools:**

| Tool | Description |
|------|-------------|
| `optimize_context` | Full pipeline — parse, graph, rank, select, serialize |
| `compress_code` | Strip comments/whitespace, optional aggressive minify |
| `count_tokens` | Exact BPE token count with tiktoken |
| `extract_diff` | Changed symbols between two file versions |
| `parse_code` | Extract all symbols with metadata |
| `analyze_context` | File stats, symbol breakdown, graph metrics |

## CLI

```bash
npx @tokenwise/cli optimize src/**/*.ts --model claude-3-sonnet --task bug-fix
npx @tokenwise/cli count src/index.ts
npx @tokenwise/cli parse src/utils.ts --format json
npx @tokenwise/cli visualize src/main.ts
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TOKENWISE CORE PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────┘

  INPUT          PARSE           GRAPH BUILD         PAGERANK
┌──────────┐  ┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ (code,   │─▶│ (tree-   │───▶│ (calls,      │───▶│ (iterative   │
│ options) │  │  sitter  │    │  imports,    │    │  centrality  │
│          │  │ + regex) │    │  inheritance)│    │  on directed │
└──────────┘  └──────────┘    └──────────────┘    │    graph)    │
                                                 └──────┬───────┘
                                                        │
                                                        ▼
  OUTPUT        SERIALIZE         SELECTION          STRATEGY
┌──────────┐  ┌──────────┐    ┌──────────────┐    ┌──────────────┐
│(Optimized│◀──│ (imports │◀──│ (greedy fill │◀──│  SELECTION   │
│ Context) │  │  + sigs  │    │  by rank     │    │ (adaptive or │
│          │  │  + bodies│    │  until       │    │  explicit)   │
│          │  │  + docs) │    │  budget)     │    │              │
└──────────┘  └──────────┘    └──────────────┘    └──────────────┘
                                               ▲
                                               │
                    ┌──────────────────────────┘
                    ▼
           ┌──────────────────┐
           │   RANKING        │
           │ (multi-factor    │
           │  score:          │
           │  visibility 15%  │
           │  callFreq  10%   │
           │  centrality 20%  │
           │  typeImp   20%   │
           │  complexity 5%   │
           │  taskRel   30%   │
           └──────────────────┘
```

## Roadmap

- [ ] **Restore map** — reversible compression with `createRestoreMap` / `restoreSymbol`
- [ ] **VS Code extension** — hover token count, inline optimization preview
- [ ] **Cache layer** — disk/Redis caching for repeated optimizations
- [ ] **More languages** — Kotlin, Scala, Dart, Zig, Elixir
- [ ] **Prompt-aware minification** — keep variable names that appear in the task prompt

## License

MIT — see [LICENSE](LICENSE)