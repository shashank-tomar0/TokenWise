/**
 * TokenWise Action — unit tests for the pure optimization helper.
 *
 * Imports the helper directly from src (no built output, no env vars, no
 * GitHub runner needed). Uses temporary directories for the codebase fixture
 * cases.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeCodebase } from '@tokenwise/core';
import { buildOptimizedContext } from '../src/core';

describe('buildOptimizedContext', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tokenwise-action-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a context for a given prompt', async () => {
    // A tiny fixture codebase the analyzer can actually parse
    const repoDir = join(tmpDir, 'fixture');
    mkdirSync(join(repoDir, 'src'), { recursive: true });

    writeFileSync(
      join(repoDir, 'src', 'math.ts'),
      [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        'export function subtract(a: number, b: number): number {',
        '  return a - b;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(repoDir, 'src', 'main.ts'),
      [
        'import { add } from "./math";',
        'export function run(): number {',
        '  return add(2, 3);',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );

    const analysis = analyzeCodebase(repoDir);
    const result = await buildOptimizedContext(analysis, 'fix the add function', 8000);

    expect(result.context.length).toBeGreaterThan(0);
    expect(result.context).toContain('add');
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(Array.isArray(result.relevantFiles)).toBe(true);
    expect(Array.isArray(result.relevantSymbols)).toBe(true);
  });

  it('respects the target token budget', async () => {
    const repoDir = join(tmpDir, 'budget');
    mkdirSync(repoDir, { recursive: true });

    // A single large symbol so its per-symbol cost far exceeds the budget
    const bigBody = Array.from({ length: 500 }, (_, i) => `  const value${i} = ${i};`).join('\n');
    writeFileSync(
      join(repoDir, 'big.ts'),
      `export function hugeFunction(): void {\n${bigBody}\n}\n`,
      'utf-8',
    );

    const analysis = analyzeCodebase(repoDir);
    const result = await buildOptimizedContext(analysis, 'refactor the huge function', 200);

    // The oversized symbol must be dropped, keeping the context within budget
    expect(result.context).not.toContain('hugeFunction');
    expect(result.tokenCount).toBeLessThanOrEqual(250);
  });

  it('handles an empty directory gracefully', async () => {
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir, { recursive: true });

    const analysis = analyzeCodebase(emptyDir);
    expect(analysis.totalFiles).toBe(0);

    const result = await buildOptimizedContext(analysis, 'explain this repo', 8000);

    // No symbols found → still a valid, non-failing header-only context
    expect(typeof result.context).toBe('string');
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.relevantFiles).toEqual([]);
    expect(result.relevantSymbols).toEqual([]);
    expect(result.tokenCount).toBeGreaterThan(0);
  });
});
