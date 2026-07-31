import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeCodebase, extractCodebaseContext } from '../src/index.js';

// ────────────────────────────────────────────────────────────
// TEST FIXTURE — small mock codebase
// ────────────────────────────────────────────────────────────

let fixtureDir = '';
let fixtureFiles: string[] = [];

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'tokenwise-test-'));
  mkdirSync(join(fixtureDir, 'src'));
  mkdirSync(join(fixtureDir, 'src', 'lib'));

  // utils.ts — helper functions
  writeFileSync(join(fixtureDir, 'src', 'utils.ts'), `
    export function formatDate(date: Date): string {
      return date.toISOString().slice(0, 10);
    }

    export function parseInput(input: string): string {
      return input.trim().toLowerCase();
    }

    function internalHelper() {
      return 'hidden';
    }
  `);

  // app.ts — imports utils
  writeFileSync(join(fixtureDir, 'src', 'app.ts'), `
    import { formatDate, parseInput } from './utils';

    export function handleUserInput(raw: string) {
      const cleaned = parseInput(raw);
      return { cleaned, when: formatDate(new Date()) };
    }

    export class UserService {
      private users: string[] = [];

      addUser(name: string): void {
        this.users.push(name);
      }

      listUsers(): string[] {
        return this.users;
      }
    }
  `);

  // lib/math.ts — pure functions
  writeFileSync(join(fixtureDir, 'src', 'lib', 'math.ts'), `
    export function add(a: number, b: number): number {
      return a + b;
    }

    export function multiply(a: number, b: number): number {
      return a * b;
    }
  `);

  // ignore me — shouldn't be scanned
  mkdirSync(join(fixtureDir, 'node_modules'));
  writeFileSync(join(fixtureDir, 'node_modules', 'fake.ts'), `
    export function fake() { return 42; }
  `);

  fixtureFiles = [
    'src/utils.ts',
    'src/app.ts',
    'src/lib/math.ts',
  ];
});

describe('Codebase Walker', () => {
  it('should discover source files', () => {
    const analysis = analyzeCodebase(fixtureDir, { maxFileSize: 100_000 });
    expect(analysis.totalFiles).toBe(3);
    const relPaths = analysis.files.map(f => f.relativePath.replace(/\\/g, '/')).sort();
    expect(relPaths).toEqual([...fixtureFiles].sort());
  });

  it('should skip node_modules', () => {
    const analysis = analyzeCodebase(fixtureDir);
    expect(analysis.files.every(f => !f.relativePath.includes('node_modules'))).toBe(true);
  });

  it('should parse symbols from all files', () => {
    const analysis = analyzeCodebase(fixtureDir);
    const names = analysis.symbols.map(s => s.name);
    expect(names).toContain('formatDate');
    expect(names).toContain('parseInput');
    expect(names).toContain('handleUserInput');
    expect(names).toContain('UserService');
    expect(names).toContain('add');
    expect(names).toContain('multiply');
    // Should NOT contain the fake from node_modules
    expect(names).not.toContain('fake');
  });

  it('should detect language distribution', () => {
    const analysis = analyzeCodebase(fixtureDir);
    expect(analysis.stats.languages['typescript']).toBe(3);
  });

  it('should build a global symbol graph', () => {
    const analysis = analyzeCodebase(fixtureDir);
    expect(analysis.stats.graphNodes).toBeGreaterThanOrEqual(analysis.stats.totalSymbols * 0.8);
    expect(analysis.stats.totalSymbols).toBeGreaterThan(0);
    expect(analysis.stats.clusters).toBeGreaterThanOrEqual(1);
  });

  it('should record processing time', () => {
    const analysis = analyzeCodebase(fixtureDir);
    expect(analysis.stats.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw on missing directory', () => {
    expect(() => analyzeCodebase('/nonexistent/path/xyz')).toThrow();
  });
});

describe('extractCodebaseContext', () => {
  it('should extract context relevant to a prompt', async () => {
    const analysis = analyzeCodebase(fixtureDir);
    const result = await extractCodebaseContext(
      analysis,
      'How does handleUserInput work? What does parseInput do?',
      500,
    );

    expect(result.context).toContain('handleUserInput');
    expect(result.context).toContain('parseInput');
    expect(result.relevantSymbols.length).toBeGreaterThan(0);
    // Budget accounts for header + separators; allow some overhead
    expect(result.tokenCount).toBeLessThanOrEqual(800);
  });

  it('should respect token budget', async () => {
    const analysis = analyzeCodebase(fixtureDir);
    const result = await extractCodebaseContext(
      analysis,
      'how do the math functions work',
      100,
    );

    // Small budget should still return something meaningful
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.tokenCount).toBeLessThanOrEqual(300);
  });
});
