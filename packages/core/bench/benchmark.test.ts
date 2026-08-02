/**
 * TokenWise Core — Benchmark Suite
 *
 * End-to-end performance benchmark for the core extraction pipeline.
 * Runs the full parse → tokenize → optimize → graph pipeline against a
 * synthetic but realistic TypeScript codebase and reports per-stage
 * timings plus the resulting token reduction.
 *
 * Uses only `vitest` + the Node `performance.now()` timer — no external
 * benchmark libraries.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCodeSync,
  countTokens,
  Tokenizer,
  optimizeContextSync,
  buildGraph,
  getGraphStats,
} from '../src/index.js';

// ════════════════════════════════════════════════════════════
// SYNTHETIC CODEBASE GENERATOR
// ════════════════════════════════════════════════════════════

// Function body templates — realistic loops, conditionals and string ops.
// NOTE: generated code intentionally avoids string/char literals (quotes are
// built with String.fromCharCode) so the regex parser's quote-parity scan —
// used to skip matches inside string literals — stays deterministic.
const FUNCTION_TEMPLATES: ReadonlyArray<string> = [
  `export function {name}(items: number[], factor: number): number {
    // Normalize the input and apply a scaling factor.
    let totalSum = 0;
    for (const item of items) {
      if (item > 0) {
        totalSum += item * factor;
      } else {
        totalSum -= Math.abs(item);
      }
    }
    /* Cap the result to stay within a safe numeric range. */
    return totalSum > windowLimit ? windowLimit : totalSum;
  }`,
  `export function {name}(records: Record<string, any>, threshold: number): Array<string> {
    const output: Array<string> = [];
    const keys = Object.keys(records);
    for (let idx = 0; idx < keys.length; idx++) {
      const value = records[keys[idx]];
      const normalized = String(value ?? 0).toLowerCase();
      if (normalized.length >= threshold) {
        output.push(keys[idx] + SEPARATOR + normalized);
      }
    }
    output.sort();
    return output;
  }`,
  `export async function {name}(src: string, times: number): Promise<string> {
    let buffer = String(src);
    for (let iteration = 0; iteration < times; iteration++) {
      buffer = buffer.replace(REGEX_NEWLINE, SLASH);
    }
    const chunks = buffer.split(SLASH);
    let assembled = EMPTY_TOKEN;
    for (const chunk of chunks) {
      if (chunk.length > 0) {
        assembled += chunk.trim();
      }
    }
    return assembled;
  }`,
  `export function {name}(rows: Array<Array<number>>): Array<number> {
    const totals: Array<number> = [];
    for (const row of rows) {
      let partial = row.length;
      let cursor = 0;
      while (cursor < row.length) {
        partial += row[cursor] % (cursor + 1);
        cursor++;
      }
      if (partial === 0) {
        partial = 1;
      }
      totals.push(partial);
    }
    return totals;
  }`,
  `export function {name}(pairs: Map<string, number>): { hits: number; misses: number; label: string } {
    let hits = 0;
    let misses = 0;
    for (const key of Array.from(pairs.keys())) {
      const value = pairs.get(key) ?? 0;
      if (value > 0) {
        hits += 1;
      } else {
        misses += 1;
      }
    }
    const label = hits >= misses ? WINS_KEY : LOSSES_KEY;
    return { hits, misses, label };
  }`,
];

const CLASS_TEMPLATES: ReadonlyArray<string> = [
  `export class {name} {
    private items: Array<number>;

    constructor(payload: Array<number>) {
      this.items = payload.slice();
    }

    public insert(value: number): number {
      this.items.push(value);
      return this.items.length;
    }

    public sum(): number {
      let running = 0;
      for (let i = 0; i < this.items.length; i++) {
        running += this.items[i];
      }
      return running;
    }

    public filter(threshold: number): Array<number> {
      const kept: Array<number> = [];
      for (const item of this.items) {
        if (item >= threshold) {
          kept.push(item);
        }
      }
      return kept;
    }
  }`,
  `export class {name} extends BaseComponent {
    private readonly label: string;
    protected buffer: Array<string>;

    constructor(label: string) {
      super();
      this.label = String(label);
      this.buffer = [];
    }

    public override push(chunk: string): void {
      this.buffer.push(chunk.trim());
    }

    private compact(): string {
      let joined = EMPTY_TOKEN;
      for (const entry of this.buffer) {
        joined += entry + SLASH;
      }
      return joined;
    }

    public snapshot(): Map<string, number> {
      const counts = new Map<string, number>();
      const merged = this.compact();
      for (const part of merged.split(SLASH)) {
        counts.set(part, (counts.get(part) ?? 0) + 1);
      }
      return counts;
    }
  }`,
];

const INTERFACE_TEMPLATES: ReadonlyArray<string> = [
  `export interface {name} {
    id: string;
    enabled: boolean;
    limit: number;
    tags: Array<string>;
  }`,
  `export interface {name} {
    key: string;
    value: number | null;
    options: Record<string, string>;
    children: Array<{name}>;
  }`,
];

const TYPE_TEMPLATES: ReadonlyArray<string> = [
  `export type {name} = Array<string>;`,
  `export type {name} = { label: string; count: number; active: boolean };`,
  `export type {name} = (input: string) => number;`,
];

// Shared sentinel constants referenced from generated bodies. Quote-free by
// construction (String.fromCharCode) so the synthetic source stays parseable
// by the regex layer without string-literal interference.
const SYNTHETIC_CONSTANTS = `
const windowLimit = 4096;
const SEPARATOR = String.fromCharCode(47);
const SLASH = String.fromCharCode(47);
const EMPTY_TOKEN = String.fromCharCode(47);
const WINS_KEY = String.fromCharCode(43);
const LOSSES_KEY = String.fromCharCode(45);
const REGEX_NEWLINE = String.fromCharCode(92, 110);
`;

/**
 * Build one synthetic TypeScript source file: `count` top-level functions
 * with real bodies, plus a fixed set of classes, interfaces, type aliases,
 * import statements and both comment styles (// and /* *​/).
 */
export function makeSyntheticFile(count: number = 50): string {
  const lines: string[] = [];

  // Header + block comment (exercises `/* */` comment stripping)
  lines.push('/**');
  lines.push(' * TokenWise benchmark synthetic module.');
  lines.push(' * Generated programmatically — do not edit by hand.');
  lines.push(' */');
  lines.push('');

  // Imports (exercises import extraction)
  for (let i = 0; i < 8; i++) {
    lines.push(`import { helper_${i} } from 'vendor_lib_${i}';`);
  }
  lines.push(`import baseConfig from 'tsconfig-helper';`);
  lines.push('');
  lines.push(SYNTHETIC_CONSTANTS.trim());
  lines.push('');

  // Top-level functions
  for (let i = 0; i < count; i++) {
    const name = `processAttribute${i}`;
    lines.push(`// Routine that computes derived values from raw input #${i}.`);
    lines.push(makeFunctionBody(name, i));
    lines.push('');
  }

  // Classes with methods + constructors
  for (let i = 0; i < 20; i++) {
    const name = `Engine${i}`;
    lines.push(`// Engine${i}: wires together ${count} processors.`);
    lines.push(makeClassBody(name, i));
    lines.push('');
  }

  // Interfaces
  for (let i = 0; i < 12; i++) {
    const name = `Contract${i}`;
    lines.push(`/* Shape contract used across engine modules. */`);
    lines.push(makeInterfaceBody(name, i));
    lines.push('');
  }

  // Type aliases
  for (let i = 0; i < 10; i++) {
    lines.push(makeTypeBody(`TypeAlias${i}`, i));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render one function body from the template pool.
 */
function makeFunctionBody(name: string, index: number): string {
  return FUNCTION_TEMPLATES[index % FUNCTION_TEMPLATES.length].replaceAll('{name}', name);
}

/**
 * Render one class body from the template pool.
 */
function makeClassBody(name: string, index: number): string {
  return CLASS_TEMPLATES[index % CLASS_TEMPLATES.length].replaceAll('{name}', name);
}

/**
 * Render one interface body from the template pool.
 */
function makeInterfaceBody(name: string, index: number): string {
  return INTERFACE_TEMPLATES[index % INTERFACE_TEMPLATES.length].replaceAll('{name}', name);
}

/**
 * Render one type alias from the template pool.
 */
function makeTypeBody(name: string, index: number): string {
  return TYPE_TEMPLATES[index % TYPE_TEMPLATES.length].replaceAll('{name}', name);
}

// ════════════════════════════════════════════════════════════
// BENCHMARK RUNNER
// ════════════════════════════════════════════════════════════

export interface BenchmarkResult {
  parseMs: number;
  tokenizeMs: number;
  optimizeMs: number;
  reductionPercent: number;
  originalTokens: number;
  optimizedTokens: number;
  symbolCount: number;
}

/**
 * Run the full extraction pipeline against the synthetic codebase and
 * return per-stage timings plus the token-reduction metrics.
 */
export async function runBenchmark(sampleCount: number = 50): Promise<BenchmarkResult> {
  const code = makeSyntheticFile(sampleCount);
  const language = 'typescript';
  const encoding = 'cl100k_base';

  // ── Parse ──
  const parseStart = performance.now();
  const symbols = parseCodeSync(code, language);
  const parseMs = Math.round((performance.now() - parseStart) * 100) / 100;

  // ── Tokenize (class-based count + ad-hoc countTokens) ──
  const tokenizeStart = performance.now();
  const tokenizer = new Tokenizer({ encoding });
  tokenizer.count(code);
  const originalTokens = countTokens(code, encoding);
  const tokenizeMs = Math.round((performance.now() - tokenizeStart) * 100) / 100;

  // ── Optimize (aggressive minify path strips bodies → real reduction) ──
  const optimizeStart = performance.now();
  const result = optimizeContextSync(code, {
    strategy: 'aggressive',
    taskType: 'bug-fix',
    model: 'claude-3-sonnet',
    language,
    encoding,
  });
  const optimizeMs = Math.round((performance.now() - optimizeStart) * 100) / 100;

  return {
    parseMs,
    tokenizeMs,
    optimizeMs,
    reductionPercent: result.reductionPercent,
    originalTokens: result.originalTokens,
    optimizedTokens: result.optimizedTokens,
    symbolCount: symbols.length,
  };
}

// ════════════════════════════════════════════════════════════
// BENCHMARK TESTS
// ════════════════════════════════════════════════════════════

describe('Benchmark', () => {
  it('should parse synthetic codebase', async () => {
    const code = makeSyntheticFile(50);
    const symbols = parseCodeSync(code, 'typescript');
    // 50 functions + 20 classes + 12 interfaces + 10 type aliases (+ constants)
    expect(symbols.length).toBeGreaterThan(50);
  });

  it('should count tokens fast', async () => {
    const code = makeSyntheticFile(50);
    const start = performance.now();
    let total = 0;
    for (let pass = 0; pass < 20; pass++) {
      total += countTokens(code);
    }
    const elapsed = (performance.now() - start) / 1000;
    expect(elapsed).toBeLessThan(5);
    expect(total).toBeGreaterThan(0);
  });

  it('should optimize with reduction', async () => {
    const metrics = await runBenchmark(50);
    // 'aggressive' + minify strips bodies, so reduction must be real.
    expect(metrics.optimizedTokens).toBeLessThan(metrics.originalTokens);
    expect(metrics.reductionPercent).toBeGreaterThan(0);
  });

  it('should log benchmark metrics', async () => {
    const metrics = await runBenchmark(50);
    const header = 'TokenWise Core benchmark (synthetic codebase)';
    // console.log is surfaced in vitest stdout so the table shows in test output.
    console.log(`\n${'═'.repeat(header.length)}`);
    console.log(header);
    console.log('═'.repeat(header.length));
    console.log(`  parseMs            ${metrics.parseMs.toFixed(2).padStart(8)} ms`);
    console.log(`  tokenizeMs         ${metrics.tokenizeMs.toFixed(2).padStart(8)} ms`);
    console.log(`  optimizeMs         ${metrics.optimizeMs.toFixed(2).padStart(8)} ms`);
    console.log(`  originalTokens     ${String(metrics.originalTokens).padStart(8)}`);
    console.log(`  optimizedTokens    ${String(metrics.optimizedTokens).padStart(8)}`);
    console.log(`  reductionPercent   ${String(metrics.reductionPercent).padStart(8)} %`);
    console.log(`  symbolCount        ${String(metrics.symbolCount).padStart(8)}`);
    console.log('');
    expect(metrics.parseMs).toBeGreaterThanOrEqual(0);
    expect(metrics.optimizeMs).toBeGreaterThanOrEqual(0);
  });

  it('should build graph', async () => {
    const code = makeSyntheticFile(50);
    const symbols = parseCodeSync(code, 'typescript');
    const graph = buildGraph(symbols, {
      maxDepth: 3,
      includeImports: true,
      includeInheritance: true,
    });
    const stats = getGraphStats(graph);
    expect(stats.totalNodes).toBeGreaterThan(0);
    expect(stats.totalEdges).toBeGreaterThanOrEqual(0);
  });
});
