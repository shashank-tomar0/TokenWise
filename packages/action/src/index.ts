#!/usr/bin/env node

/**
 * TokenWise Optimize Context — GitHub Action entry point.
 *
 * Reads action inputs from the environment (GitHub Actions convention:
 * `INPUT_<NAME>` with names uppercased and dashes → underscores), analyzes
 * the repository with @tokenwise/core, writes an `optimized-context.txt`
 * into the repo root (or GITHUB_WORKSPACE), and sets the `optimized-context`
 * output via the $GITHUB_OUTPUT file.
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeCodebase } from '@tokenwise/core';
import { buildOptimizedContext } from './core.js';

const OUTPUT_FILE_NAME = 'optimized-context.txt';

interface ActionInputs {
  path: string;
  targetTokens: number;
  strategy: string;
}

/** Read and normalize GitHub Action inputs from the environment. */
function getInputs(): ActionInputs {
  const path = process.env.INPUT_PATH?.trim() || '.';
  const rawTokens = process.env.INPUT_TARGET_TOKENS?.trim() || '8000';
  const targetTokens = parseInt(rawTokens, 10);
  const strategy = process.env.INPUT_STRATEGY?.trim() || 'adaptive';

  if (Number.isNaN(targetTokens) || targetTokens <= 0) {
    throw new Error(`Invalid target-tokens input: "${rawTokens}" (expected a positive integer)`);
  }

  return { path, targetTokens, strategy };
}

/** Resolve the absolute directory the action should analyze. */
function resolveRootDir(inputPath: string): string {
  const base = process.env.GITHUB_WORKSPACE ?? process.cwd();
  return resolve(base, inputPath);
}

/** Where the optimized context file should be written. */
function resolveOutputDir(inputPath: string): string {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (workspace) return workspace;
  // Local run: write next to the analyzed path so it lands in the repo root.
  return resolveRootDir(inputPath);
}

/** Write a value to the GitHub Actions output file ($GITHUB_OUTPUT). */
function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return; // local run — output is reported on stdout instead
  appendFileSync(outputFile, `${name}=${value}\n`, 'utf-8');
}

async function run(): Promise<void> {
  const inputs = getInputs();
  const rootDir = resolveRootDir(inputs.path);

  console.log(`[tokenwise-action] input path: ${inputs.path}`);
  console.log(`[tokenwise-action] target tokens: ${inputs.targetTokens}`);
  console.log(`[tokenwise-action] strategy: ${inputs.strategy}`);
  console.log(`[tokenwise-action] analyzing ${rootDir} ...`);

  // 1. Analyze the codebase
  const analysis = analyzeCodebase(rootDir, {
    rootDir,
    detectEntryPoints: true,
  });

  // 2. Extract an optimized context for the PR/issue task prompt.
  //    Falls back to a generic prompt when the event body is unavailable.
  const taskPrompt =
    process.env.PR_BODY?.trim() ||
    process.env.ISSUE_BODY?.trim() ||
    'Understand the codebase structure, key modules, and main entry points';

  const result = await buildOptimizedContext(analysis, taskPrompt, inputs.targetTokens);

  // 3. Write the context file into the repo root / workspace
  const outputDir = resolveOutputDir(inputs.path);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, OUTPUT_FILE_NAME);
  writeFileSync(outputPath, result.context, 'utf-8');
  setOutput('optimized-context', outputPath);

  // 4. Summary
  const inputTokens = analysis.totalTokens;
  console.log('──────────────────────────────────────────────');
  console.log('✅ TokenWise Optimize Context — summary');
  console.log('──────────────────────────────────────────────');
  console.log(`  Files analyzed:    ${analysis.totalFiles}`);
  console.log(`  Files parsed:      ${analysis.parsedFiles}`);
  console.log(`  Symbols found:     ${analysis.stats.totalSymbols}`);
  console.log(`  Entry points:      ${analysis.entryPoints.length > 0 ? analysis.entryPoints.join(', ') : 'none detected'}`);
  console.log(`  Input tokens:      ${inputTokens}`);
  console.log(`  Context tokens:    ${result.tokenCount} (budget: ${inputs.targetTokens})`);
  console.log(`  Included files:    ${result.relevantFiles.length}`);
  console.log(`  Included symbols:  ${result.relevantSymbols.length}`);
  console.log(`  Context written:   ${outputPath}`);
  console.log(`  Output (GitHub):   optimized-context=${outputPath}`);
  console.log('──────────────────────────────────────────────');

  if (analysis.totalFiles === 0) {
    console.warn(`[tokenwise-action] warning: no source files found under ${rootDir}`);
  }
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[tokenwise-action] error: ${message}`);
  process.exit(1);
});
