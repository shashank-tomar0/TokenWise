#!/usr/bin/env node

/**
 * TokenWise CLI - Reduce AI coding token usage
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { optimizeContext, compressContext, extractDiff, countTokens } from '@tokenwise/core';

// Simple chalk-like colored output (avoiding import issues)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

const program = new Command();

program
  .name('tokenwise')
  .description('Optimize code context to reduce AI token usage')
  .version('0.1.0');

program
  .command('optimize')
  .description('Optimize code for AI context (reduce tokens while keeping meaning)')
  .argument('<file>', 'File to optimize')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-t, --target-tokens <number>', 'Target token count', (v) => parseInt(v))
  .option('-m, --max-tokens <number>', 'Maximum token count', (v) => parseInt(v))
  .option('-l, --language <lang>', 'Language (auto-detected if not provided)')
  .option('-s, --signatures-only', 'Only include function/class signatures')
  .option('-c, --compress', 'Apply compression (remove comments, whitespace)')
  .action(async (file: string, options) => {
    try {
      const code = readFileSync(resolve(file), 'utf-8');
      const language = options.language as any;

      let result;

      if (options.compress) {
        result = compressContext(code, {
          language,
          includeBodies: !options.signaturesOnly,
        });
      } else {
        result = optimizeContext(code, {
          language,
          targetTokens: options.targetTokens,
          maxTokens: options.maxTokens,
          includeBodies: !options.signaturesOnly,
        });
      }

      log(`\nFile: ${file}`, 'cyan');
      log(`Original tokens: ${result.originalTokens}`, 'reset');
      log(`Optimized tokens: ${result.optimizedTokens}`, 'reset');
      log(`Reduction: ${result.reductionPercent}%`, 'green');
      log(`Strategy: ${result.strategy}`, 'yellow');

      // Also show top symbols included/excluded
      if (result.includedSymbols.length > 0) {
        log(`\nIncluded symbols:`, 'reset');
        result.includedSymbols.slice(0, 10).forEach((s) => log(`  + ${s}`, 'green'));
        if (result.includedSymbols.length > 10) {
          log(`  ... and ${result.includedSymbols.length - 10} more`, 'reset');
        }
      }

      if (result.excludedSymbols.length > 0) {
        log(`\nExcluded symbols:`, 'reset');
        result.excludedSymbols.slice(0, 5).forEach((s) => log(`  - ${s}`, 'red'));
        if (result.excludedSymbols.length > 5) {
          log(`  ... and ${result.excludedSymbols.length - 5} more`, 'reset');
        }
      }

      const output = options.output
        ? writeFileSync(resolve(options.output), result.code)
        : console.log('\n--- Optimized Code ---\n' + result.code);

    } catch (err) {
      log(`Error: ${err}`, 'red');
      process.exit(1);
    }
  });

program
  .command('count')
  .description('Count tokens in a file')
  .argument('<file>', 'File to count tokens')
  .option('-e, --encoding <enc>', 'Token encoding (cl100k_base, p50k_base, r50k_base)')
  .action((file: string, options) => {
    try {
      const code = readFileSync(resolve(file), 'utf-8');
      const tokens = countTokens(code, { encoding: options.encoding as any });

      log(`File: ${file}`, 'cyan');
      log(`Tokens: ${tokens}`, 'green');
      log(`Characters: ${code.length}`, 'reset');
      log(`Ratio: ${(code.length / tokens).toFixed(2)} chars/token`, 'reset');

    } catch (err) {
      log(`Error: ${err}`, 'red');
      process.exit(1);
    }
  });

program
  .command('diff')
  .description('Extract only changed symbols between two files')
  .argument('<original>', 'Original file')
  .argument('<modified>', 'Modified file')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action((original: string, modified: string, options) => {
    try {
      const originalCode = readFileSync(resolve(original), 'utf-8');
      const modifiedCode = readFileSync(resolve(modified), 'utf-8');

      const result = extractDiff(originalCode, modifiedCode);

      log(`\nOriginal: ${original}`, 'reset');
      log(`Modified: ${modified}`, 'reset');
      log(`Tokens saved: ${result.originalTokens - result.optimizedTokens} (${result.reductionPercent}%)`, 'green');

      const output = options.output
        ? writeFileSync(resolve(options.output), result.code)
        : console.log('\n--- Changed Symbols ---\n' + result.code);

    } catch (err) {
      log(`Error: ${err}`, 'red');
      process.exit(1);
    }
  });

program
  .command('batch')
  .description('Optimize multiple files in a directory')
  .argument('<directory>', 'Directory containing source files')
  .option('--pattern <glob>', 'File pattern (e.g., "**/*.ts")', '**/*.{ts,js}')
  .option('-r, --recursive', 'Process recursively')
  .action(async (directory: string, options) => {
    log(`Batch optimization not yet implemented`, 'yellow');
    log(`Use individual file optimization for now`, 'reset');
  });

program.parse();