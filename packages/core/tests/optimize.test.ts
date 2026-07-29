import { describe, it, expect } from 'vitest';
import {
  // Core pipeline
  optimizeContext, optimizeContextSync,
  compressContext, extractDiff,

  // Tokenizer
  countTokens, estimateTokens, estimateTokensFast,
  Tokenizer, CodeTokenEstimator,
  splitToFit, tokensToChars, formatTokenComparison,

  // Parser
  parseCodeSync, detectLanguage,

  // Graph
  buildGraph, findShortestPath, findHotPath,
  findOrphanedSymbols, findEntryCandidates, getGraphStats,

  // Strategies
  selectStrategy, rankSymbols, applyStrategySelection, allocateBudget,
  STRATEGY_PROFILES,

  // Compression
  compress, smartCompress, compressFull,

  // Types
  DEFAULT_ENCODING,
} from '../src/index.js';

// ════════════════════════════════════════════════════════════
// TOKENIZER
// ════════════════════════════════════════════════════════════

describe('Tokenizer', () => {
  describe('countTokens', () => {
    it('should count empty string as 0', () => {
      expect(countTokens('')).toBe(0);
    });

    it('should count simple code', () => {
      const code = 'function hello() { return "world"; }';
      const tokens = countTokens(code);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(code.length);
    });

    it('should estimate more tokens for longer code', () => {
      const short = 'x = 1';
      const long = 'function hello() { return "world"; }';
      expect(countTokens(long)).toBeGreaterThan(countTokens(short));
    });

    it('should be deterministic', () => {
      const code = 'const x: number = 42; export function foo() {}';
      expect(countTokens(code)).toBe(countTokens(code));
    });
  });

  describe('Tokenizer class', () => {
    it('should cache repeated calls', () => {
      const t = new Tokenizer({ encoding: 'cl100k_base' });
      const code = 'export function test() { return true; }';
      const first = t.count(code);
      const second = t.count(code);
      expect(first).toBe(second);
      const stats = t.getStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should estimate with breakdown', () => {
      const t = new Tokenizer();
      const code = '// comment\nconst x = 1; /* block */';
      const est = t.estimate(code);
      expect(est.tokens).toBeGreaterThan(0);
      expect(est.characters).toBe(code.length);
      expect(est.lines).toBe(2);
      expect(est.commentTokens).toBeGreaterThanOrEqual(0);
    });

    it('should split to fit within budget', () => {
      const t = new Tokenizer();
      const code = Array.from({ length: 100 }, (_, i) => `function func${i}() { return ${i}; }`).join('\n');
      const chunks = t.splitToFit(code, 50);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(t.count(chunk)).toBeLessThanOrEqual(70); // slight budget tolerance
      });
    });

    it('should return single chunk for small code', () => {
      const t = new Tokenizer();
      const code = 'const x = 1;';
      const chunks = t.splitToFit(code, 1000);
      expect(chunks).toEqual([code]);
    });

    it('should handle cache clear', () => {
      const t = new Tokenizer();
      t.count('test');
      t.clearCache();
      const stats = t.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
    });

    it('should provide encoding info', () => {
      const t = new Tokenizer({ encoding: 'cl100k_base' });
      const info = t.getEncodingInfo();
      expect(info?.name).toBe('cl100k_base');
      expect(info?.vocabSize).toBeGreaterThan(0);
    });
  });

  describe('CodeTokenEstimator', () => {
    it('should estimate code', () => {
      const code = 'function hello() { return "world"; }';
      const tokens = CodeTokenEstimator.estimate(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty input', () => {
      expect(CodeTokenEstimator.estimate('')).toBe(0);
    });
  });

  describe('estimateTokensFast', () => {
    it('should provide fast estimates', () => {
      const code = 'function hello() { return "world"; }';
      const tokens = estimateTokensFast(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should respect encoding parameter', () => {
      const code = 'function hello() { return "world"; }';
      const t1 = estimateTokensFast(code, 'cl100k_base');
      const t2 = estimateTokensFast(code, 'o200k_base');
      expect(t1).not.toBe(t2);
    });
  });

  describe('utility functions', () => {
    it('tokensToChars should convert', () => {
      expect(tokensToChars(100)).toBe(350);
    });

    it('formatTokenComparison should format', () => {
      const result = formatTokenComparison(100, 30);
      expect(result).toContain('100');
      expect(result).toContain('30');
      expect(result).toContain('70.0');
    });

    it('splitToFit should split', () => {
      const code = 'line1\nline2\nline3\nline4\n';
      const chunks = splitToFit(code, 5);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ════════════════════════════════════════════════════════════
// PARSER
// ════════════════════════════════════════════════════════════

describe('Parser', () => {
  describe('detectLanguage', () => {
    it('should detect from extension', () => {
      expect(detectLanguage('file.ts')).toBe('typescript');
      expect(detectLanguage('file.jsx')).toBe('javascript');
      expect(detectLanguage('file.py')).toBe('python');
      expect(detectLanguage('file.go')).toBe('go');
      expect(detectLanguage('file.rs')).toBe('rust');
      expect(detectLanguage('file.java')).toBe('java');
    });

    it('should default to typescript for unknown', () => {
      expect(detectLanguage('file.xyz')).toBe('typescript');
    });
  });

  describe('parseCodeSync', () => {
    it('should extract functions', () => {
      const code = `
        function hello() { return "world"; }
        function goodbye(a: number) { return a; }
      `;
      const symbols = parseCodeSync(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).toContain('hello');
      expect(names).toContain('goodbye');
    });

    it('should extract classes', () => {
      const code = `
        class User {
          name: string;
          constructor(name: string) { this.name = name; }
          greet() { return "Hello"; }
        }
      `;
      const symbols = parseCodeSync(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).toContain('User');
    });

    it('should extract interfaces', () => {
      const code = `interface User { name: string; age: number; }`;
      const symbols = parseCodeSync(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).toContain('User');
      expect(symbols.find(s => s.name === 'User')?.type).toBe('interface');
    });

    it('should extract type aliases', () => {
      const code = `type UserID = string;`;
      const symbols = parseCodeSync(code, 'typescript');
      expect(symbols.some(s => s.name === 'UserID')).toBe(true);
    });

    it('should extract enums', () => {
      const code = `enum Color { Red, Green, Blue }`;
      const symbols = parseCodeSync(code, 'typescript');
      expect(symbols.some(s => s.name === 'Color')).toBe(true);
    });

    it('should extract exported symbols', () => {
      const code = `export function doSomething() {}`;
      const symbols = parseCodeSync(code, 'typescript');
      const sym = symbols.find(s => s.name === 'doSomething');
      expect(sym?.isExported).toBe(true);
    });

    it('should handle empty input', () => {
      expect(parseCodeSync('', 'typescript')).toEqual([]);
    });

    it('should extract Python functions and classes', () => {
      const code = `
        def hello():
            return "world"

        class User:
            def __init__(self, name):
                self.name = name
      `;
      const symbols = parseCodeSync(code, 'python');
      const names = symbols.map(s => s.name);
      expect(names).toContain('hello');
      expect(names).toContain('User');
    });

    it('should extract Go functions', () => {
      const code = `
        package main
        func hello() string { return "world" }
        func goodbye(x int) int { return x }
      `;
      const symbols = parseCodeSync(code, 'go');
      expect(symbols.some(s => s.name === 'hello')).toBe(true);
      expect(symbols.some(s => s.name === 'goodbye')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════
// SYMBOL GRAPH
// ════════════════════════════════════════════════════════════

describe('Symbol Graph', () => {
  const makeSymbol = (id: string, name: string, source: string, opts?: { isExported?: boolean }) => ({
    id,
    name,
    type: 'function' as const,
    filePath: 'test.ts',
    range: { start: { line: 1, column: 0, offset: 0 }, end: { line: 2, column: 0, offset: source.length } },
    startLine: 1,
    endLine: 2,
    signature: `${name}() { ... }`,
    fullSource: source,
    visibility: 'public' as const,
    isExported: opts?.isExported ?? false,
    isAsync: false,
    isGenerator: false,
    dependencies: [],
    dependents: [],
    importStatements: [],
    importanceScore: 0,
    callCount: 0,
    lineCount: 2,
    complexity: 1,
    parameters: [],
    parent: undefined,
    children: [],
  });

  it('should build a graph from symbols', () => {
    const symbols = [
      makeSymbol('1', 'main', 'function main() { helper(); }'),
      makeSymbol('2', 'helper', 'function helper() { return 42; }'),
    ];
    const graph = buildGraph(symbols);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect pageRank centrality', () => {
    // helper is called by 2 other functions — should have higher centrality
    const symbols = [
      makeSymbol('1', 'main', 'function main() { helper(); util(); }'),
      makeSymbol('2', 'helper', 'function helper() { return 1; }'),
      makeSymbol('3', 'util', 'function util() { return 2; }'),
    ];
    const graph = buildGraph(symbols);
    const helperNode = graph.nodes.get('2');
    expect(helperNode?.pageRank).toBeGreaterThan(0);
  });

  it('should find entry candidates', () => {
    const symbols = [
      makeSymbol('1', 'main', 'function main() { helper(); }', { isExported: true }),
      makeSymbol('2', 'helper', 'function helper() { return 42; }'),
    ];
    const graph = buildGraph(symbols);
    const candidates = findEntryCandidates(graph);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('should provide graph stats', () => {
    const symbols = [
      makeSymbol('1', 'a', 'function a() { b(); }'),
      makeSymbol('2', 'b', 'function b() { return 1; }'),
    ];
    const graph = buildGraph(symbols);
    const stats = getGraphStats(graph);
    expect(stats.totalNodes).toBe(2);
    expect(stats.totalEdges).toBeGreaterThan(0);
    expect(typeof stats.clusters).toBe('number');
    expect(typeof stats.avgPageRank).toBe('number');
  });

  it('should handle empty input', () => {
    const graph = buildGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// STRATEGY ENGINE
// ════════════════════════════════════════════════════════════

describe('Strategy Engine', () => {
  it('should have all strategies defined', () => {
    expect(Object.keys(STRATEGY_PROFILES)).toEqual(
      ['aggressive', 'balanced', 'preservative', 'semantic', 'adaptive']
    );
  });

  it('should select a strategy for a model', () => {
    const strategy = selectStrategy('balanced', 'claude-3-sonnet', 'general', 8000);
    expect(strategy.profile.name).toBe('balanced');
    expect(strategy.budget.criticalBudget).toBeGreaterThan(0);
    expect(strategy.budget.importantBudget).toBeGreaterThan(0);
  });

  it('should auto-select preservative for large-context models', () => {
    const strategy = selectStrategy('adaptive', 'claude-3-opus', 'code-review', 100000, 1000);
    expect(['preservative', 'balanced']).toContain(strategy.profile.name);
  });

  it('should auto-select aggressive for tight windows', () => {
    const strategy = selectStrategy('adaptive', 'local', 'bug-fix', 2000, 50000);
    expect(['aggressive', 'semantic']).toContain(strategy.profile.name);
  });

  it('should allocate budget correctly', () => {
    const budget = allocateBudget(10000,
      { name: 'balanced', description: '', symbolBodyWeight: 0.4, commentWeight: 0.2, importDensity: 0.6, graphDepth: 2, aggressiveMinify: false },
      null,
    );
    const total = budget.criticalBudget + budget.importantBudget + budget.relevantBudget +
      budget.dependencyBudget + budget.documentationBudget;
    expect(total).toBeLessThanOrEqual(10000);
  });

  it('should rank symbols by importance', () => {
    const symbols = [{
      id: '1', name: 'main', type: 'function' as const,
      filePath: '', range: { start: { line: 1, column: 0, offset: 0 }, end: { line: 2, column: 0, offset: 0 } },
      startLine: 1, endLine: 2,
      signature: 'main()', fullSource: 'function main() { return 1; }',
      visibility: 'public' as const, isExported: true, isAsync: false, isGenerator: false,
      dependencies: [], dependents: [], importStatements: [],
      importanceScore: 0, callCount: 5, lineCount: 3, complexity: 2,
      parameters: [], parent: undefined, children: [],
    }];
    const strategy = selectStrategy('balanced', 'claude-3-sonnet', 'general', 8000);
    const ranked = rankSymbols(symbols, strategy);
    expect(ranked.length).toBe(1);
    expect(ranked[0].rank).toBeGreaterThan(0);
    expect(ranked[0].rankFactors).toBeDefined();
    expect(ranked[0].reason.length).toBeGreaterThan(0);
  });

  it('should apply strategy selection to include/exclude', () => {
    const symbols = [
      { id: '1', name: 'main', type: 'function' as const, filePath: '', range: { start: { line: 1, column: 0, offset: 0 }, end: { line: 10, column: 0, offset: 0 } }, startLine: 1, endLine: 10, signature: 'main() { ... }', fullSource: 'function main() { return 1; }', visibility: 'public' as const, isExported: true, isAsync: false, isGenerator: false, dependencies: [], dependents: [], importStatements: [], importanceScore: 0, callCount: 0, lineCount: 10, complexity: 1, parameters: [], parent: undefined, children: [],
        rank: 90, rankFactors: { visibility: 20, callFrequency: 10, centrality: 20, typeImportance: 15, complexity: 5, taskRelevance: 20 }, shouldKeepBody: true, reason: 'high importance' },
      { id: '2', name: 'helper', type: 'function' as const, filePath: '', range: { start: { line: 11, column: 0, offset: 0 }, end: { line: 12, column: 0, offset: 0 } }, startLine: 11, endLine: 12, signature: 'helper() { ... }', fullSource: 'function helper() { return 2; }', visibility: 'public' as const, isExported: false, isAsync: false, isGenerator: false, dependencies: [], dependents: [], importStatements: [], importanceScore: 0, callCount: 0, lineCount: 2, complexity: 1, parameters: [], parent: undefined, children: [],
        rank: 30, rankFactors: { visibility: 5, callFrequency: 5, centrality: 5, typeImportance: 10, complexity: 2, taskRelevance: 3 }, shouldKeepBody: false, reason: 'low importance' },
    ];
    const strategy = selectStrategy('balanced', 'claude-3-sonnet', 'general', 8000);
    const { included, excluded } = applyStrategySelection(symbols, strategy, 8000);
    expect(included.length).toBeGreaterThan(0);
    // High-ranked symbol should be included
    expect(included.some(s => s.name === 'main')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// COMPRESSION
// ════════════════════════════════════════════════════════════

describe('Compression', () => {
  it('should handle empty input', () => {
    expect(compress('')).toBe('');
  });

  it('should remove comments', () => {
    const code = `
      // single line
      const x = 1; /* block */
      /** doc */ const y = 2;
    `;
    const result = compress(code, { removeComments: true });
    expect(result).not.toContain('single line');
    expect(result).not.toContain('block');
  });

  it('should remove blank lines', () => {
    const code = 'function a() {}\n\n\nfunction b() {}';
    const result = compress(code, { removeBlankLines: true });
    expect(result.split('\n').filter(l => l.trim()).length).toBeLessThan(code.split('\n').length);
  });

  it('should preserve string literals when removing comments', () => {
    const code = 'const msg = "// not a comment"; const x = 1; // real comment';
    const result = compress(code, { removeComments: true });
    expect(result).toContain('"// not a comment"');
    expect(result).not.toContain('real comment');
  });

  it('should support aggressive minification', () => {
    const code = `function test(a, b) {\n  return a + b;\n}`;
    const result = compress(code, { minify: true, removeComments: true, removeBlankLines: true, collapseWhitespace: true });
    expect(result.length).toBeLessThan(code.length);
    expect(result).toContain('return a+b');
  });

  it('should preserve shebang', () => {
    const code = '#!/usr/bin/env node\nconsole.log("hello");';
    const result = smartCompress(code, { preserveShebang: true });
    expect(result).toContain('#!/usr/bin/env node');
  });

  it('should estimate compression patterns', () => {
    const code = `// comment 1\n// comment 2\nconst x = 1;`;
    const patterns = compressFull(code, { removeComments: true, removeBlankLines: true });
    expect(patterns.originalSize).toBeGreaterThan(patterns.compressedSize);
    expect(patterns.removedPatterns.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// EXTRACTION PIPELINE
// ════════════════════════════════════════════════════════════

describe('Extraction Pipeline', () => {
  describe('optimizeContextSync', () => {
    it('should handle empty input', () => {
      const result = optimizeContextSync('');
      expect(result.originalTokens).toBe(0);
      expect(result.optimizedTokens).toBe(0);
      expect(result.reductionPercent).toBe(0);
    });

    it('should extract function signatures', () => {
      const funcs = [];
      for (let i = 0; i < 20; i++) {
        funcs.push(`function func${i}() { let x = ${i}; return x * ${i + 1}; }`);
      }
      const code = funcs.join('\n');

      const result = optimizeContextSync(code, {
        language: 'typescript',
        strategy: 'aggressive',
        includeBodies: false,
      });

      expect(result.includedSymbols.length).toBeGreaterThan(0);
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('should respect token budget', () => {
      const funcs = [];
      for (let i = 0; i < 50; i++) {
        funcs.push(`export function func${i}() { let x = ${i}; return x + ${i + 1}; }`);
      }
      const code = funcs.join('\n');

      const result = optimizeContextSync(code, {
        targetTokens: 150,
        strategy: 'aggressive',
      });

      // Should select fewer symbols than total available (budget constraint)
      expect(result.includedSymbols.length).toBeLessThan(50);
    });

    it('should include relevance info', () => {
      const code = 'function parseUser() {}\nfunction renderUI() {}';
      const result = optimizeContextSync(code, { language: 'typescript' });
      expect(result.totalSymbolsFound).toBeGreaterThanOrEqual(2);
    });

    it('should provide reduction stats', () => {
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(`function func${i}() { return ${i}; }`);
      }
      const code = lines.join('\n');
      const result = optimizeContextSync(code, { strategy: 'aggressive', targetTokens: 200 });
      expect(result.optimizedTokens).toBeGreaterThan(0);
    });
  });

  describe('compressContext', () => {
    it('should remove comments', () => {
      const code = [
        '// This is a comment',
        'function hello() {',
        '  return "world"; // inline comment',
        '}',
        '/* Multi-line',
        '   comment */',
      ].join('\n');

      const result = compressContext(code);
      expect(result.code).not.toContain('// This is a comment');
      expect(result.code).not.toContain('inline comment');
    });
  });

  describe('extractDiff', () => {
    it('should detect changes between files', () => {
      const original = [
        'function old() {',
        '  return "original";',
        '}',
        'function stable() {',
        '  return "unchanged";',
        '}',
        'function helper() {',
        '  return 42;',
        '}',
      ].join('\n');

      const modified = [
        'function old() {',
        '  return "new value";',
        '}',
        'function stable() {',
        '  return "unchanged";',
        '}',
        'function helper() {',
        '  return 42;',
        '}',
        'function newFunc() {',
        '  return "added";',
        '}',
      ].join('\n');

      const result = extractDiff(original, modified);
      // Should find the newly added function
      expect(result.includedSymbols).toContain('newFunc');
      // The diff output should contain the new function's code
      expect(result.code).toContain('newFunc');
    });
  });

  describe('multi-language', () => {
    it('should parse Python code', () => {
      const code = [
        'def hello():',
        '    return "world"',
        '',
        'class User:',
        '    def __init__(self, name):',
        '        self.name = name',
      ].join('\n');

      const result = optimizeContextSync(code, { language: 'python' });
      expect(result.includedSymbols).toContain('hello');
      expect(result.language).toBe('python');
    });
  });
});

// ════════════════════════════════════════════════════════════
// DEFAULT ENCODING
// ════════════════════════════════════════════════════════════

describe('Defaults', () => {
  it('should have a default encoding', () => {
    expect(DEFAULT_ENCODING).toBe('cl100k_base');
  });

  it('should have all strategy profiles', () => {
    expect(STRATEGY_PROFILES.aggressive.aggressiveMinify).toBe(true);
    expect(STRATEGY_PROFILES.preservative.aggressiveMinify).toBe(false);
    expect(STRATEGY_PROFILES.balanced.symbolBodyWeight).toBe(0.4);
  });
});
