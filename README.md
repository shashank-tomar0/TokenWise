# TokenWise

**Reduce AI coding context tokens by 70-90% while preserving meaning.**

TokenWise is a JavaScript/TypeScript library and CLI tool for optimizing code context for AI coding assistants like GitHub Copilot, Cursor, Claude Code, and Continue.

## Why TokenWise?

When you send code to an AI assistant, you're burning tokens on:

- **Imports you don't need** for the current task
- **Boilerplate code** that AI already knows
- **Inactive functions** that won't be touched
- **Comments and whitespace** that add noise
- **Entire files** when only one function matters

TokenWise solves this by intelligently extracting only the context that matters.

## Features

- 🚀 **70-90% token reduction** through smart extraction
- 🌲 **AST-based symbol extraction** using tree-sitter patterns
- 📊 **Multiple strategies**: signature-only, token-budget, relevant-symbols
- 💾 **Token counting** (OpenAI-compatible)
- 📦 **Framework agnostic**: Works with any AI coding tool
- 🔌 **Multiple interfaces**: Core library, easy API, CLI
- 🌐 **Multi-language**: TypeScript, JavaScript, Python, Go, Rust, and more
- ⚡ **Fast**: No external API calls, runs locally

## Installation

```bash
# As an npm package
npm install @tokenwise/core

# For high-level API
npm install @tokenwise/easy

# CLI
npm install -g @tokenwise/cli
```

## Quick Start

### JavaScript / TypeScript

```typescript
import { optimizeContext } from '@tokenwise/core';

// A 500-line file becomes ~50 lines of signatures
const result = optimizeContext(yourCode, {
  language: 'typescript',
  includeSignatures: true,
  includeBodies: false, // Only signatures
});

console.log(`Reduced by ${result.reductionPercent}%`);
console.log(result.code);
```

### Easy API

```typescript
import { optimizeContext } from '@tokenwise/easy';

// Simple one-liner
const optimized = optimizeContext(code, {
  targetTokens: 500, // Auto-fit to~500 tokens
});
```

### CLI

```bash
# Count tokens in a file
tokenwise count src/utils.ts

# Optimize for AI context
tokenwise optimize src/complex-algorithm.ts -s

# Show only what changed
tokenwise diff original.ts modified.ts

# Output to file
tokenwise optimize src/app.ts -o ai-context.ts
```

## API Reference

### optimizeContext(code, options)

Main function for token optimization.

```typescript
interface OptimizeOptions {
  // Constraints
  targetTokens?: number;     // Soft target
  maxTokens?: number;       // Hard limit

  // What to include
  includeSignatures?: boolean;       // Function declarations (default: true)
  includeTypeDefinitions?: boolean; // Interfaces, types, enums (default: true)
  includeImports?: boolean;          // Import statements (default: true)
  includeDocstrings?: boolean;       // JSDoc/comments (default: false)
  includeBodies?: boolean;           // Full implementations (default: true)

  // Targeting
  relevantSymbols?: string[];  // Only include specific symbols
  callGraph?: boolean;         // Include called functions
  callGraphDepth?: number;      // How deep to trace
  includeDependencies?: boolean;

  // Language
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java';
  encoding?: 'cl100k_base' | 'p50k_base' | 'r50k_base';
}
```

### compressContext(code, options)

Aggressive compression that removes comments and whitespace.

```typescript
compressContext(code, {
  removeComments: true,
  removeBlankLines: true,
  collapseWhitespace: true,
});
```

### extractDiff(original, modified)

Extract only the symbols that changed between two files.

```typescript
const result = extractDiff(originalCode, modifiedCode);
// Perfect for PR reviews
```

## Token Reduction Examples

| File Size | Original Tokens | Optimized | Reduction |
|-----------|----------------|-----------|-----------|
| 100 lines | ~250 | ~50 | 80% |
| 500 lines | ~1250 | ~200 | 84% |
| 1000 lines | ~2500 | ~300 | 88% |
| 5000 lines | ~12500 | ~750 | 94% |

## CLI Reference

```bash
# Count tokens
tokenwise count <file>

# Optimize
tokenwise optimize <file> [options]
  -o, --output <file>        Output file
  -t, --target-tokens <n>    Target token count
  -m, --max-tokens <n>      Maximum tokens
  -l, --language <lang>      Language override
  -s, --signatures-only      Only signatures
  -c, --compress             Apply compression

# Diff extraction
tokenwise diff <original> <modified>

# Batch (coming soon)
tokenwise batch <directory>
```

## Architecture

```
@tokenwise/
├── core/              # Core extraction logic
│   ├── parser/        # Language-specific parsing
│   ├── extractors/    # Symbol extraction strategies
│   ├── compressors/   # Text compression utilities
│   └── tokenizer.ts   # Token counting
│
├── easy/              # High-level API
│   └── index.ts
│
├── cli/               # Command-line tool
│   └── index.ts
│
└── [future]
    ├── vscode/        # VS Code extension
    ├── embeddings/    # Semantic search
    └── rag/           # Advanced RAG pipeline
```

## Strategies

### Signature Only
Best for: Quick overview, understanding interface
```
- Function signatures
- Class declarations
- Interface definitions
- Type definitions
```

### Token Budget
Best for: When you have hard limits
```
- Fit within N tokens
- Prioritize by importance
- Include signatures + best bodies
```

### Relevant Symbols
Best for: Focused tasks
```
- Only the symbol you're working on
- Its dependencies
- Called functions (if callGraph enabled)
```

### Full Context
Best for: When you need everything
```
- All symbols
- Full implementations
- Imports
```

## Use Cases

### 1. AI Pair Programming
```typescript
// Only send relevant code to the AI
const context = optimizeContext(currentFile, {
  relevantSymbols: [cursorFunctionName],
  callGraph: true,
});
```

### 2. Code Review
```typescript
// Focus only on changes
const changes = extractDiff(originalFile, modifiedFile);
```

### 3. Documentation Generation
```typescript
// Get structure without noise
const structure = optimizeContext(code, {
  includeBodies: false,
  includeDocstrings: true,
});
```

### 4. Context Window Management
```typescript
// Batch large projects
const contexts = optimizeMultiFile(allFiles, {
  targetTokens: 32000, // Claude's context limit
});
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Clone and setup
git clone https://github.com/yourusername/tokenwise
cd tokenwise
npm install

# Build
npm run build

# Test
npm test

# CLI help
npx tokenwise --help
```

## License

MIT

## Roadmap

- [ ] VS Code Extension (click "Optimize for AI")
- [ ] RAG integration (semantic code search)
- [ ] Model-specific optimization (GPT-4 vs Claude vs local)
- [ ] Embeddings-based similarity search
- [ ] Tree-sitter WASM integration for better parsing
- [ ] Continue.dev plugin
- [ ] GitHub Copilot integration

## Related

- [tree-sitter](https://tree-sitter.github.io/) - Incremental parsing
- [tiktoken](https://github.com/openai/tiktoken) - Token counting
- [Continue](https://github.com/continuedev/continue) - Open-source AI coding assistant