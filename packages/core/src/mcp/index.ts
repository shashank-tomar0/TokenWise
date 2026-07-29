/**
 * TokenWise MCP Server — Model Context Protocol integration
 *
 * Exposes TokenWise as MCP tools that any AI agent can call:
 *   - optimize_context     Full extraction pipeline
 *   - compress_code        Aggressive/smart compression
 *   - count_tokens         Token counting
 *   - extract_diff         Diff between file versions
 *   - parse_code           Parse & extract symbols
 *   - codebase_scan        Walk a directory & build symbol graph
 *
 * Each tool returns structured JSON + the optimized text.
 */

import type { Language, Model, ExtractionStrategy, TaskType, TokenEncoding } from '../types.js';

// ────────────────────────────────────────────────────────────
// TOOL DEFINITIONS — MCP-compatible schema
// ────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'optimize_context',
    description: 'Extract the most important symbols from code, compressing to fit a token budget while preserving semantic meaning',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to optimize' },
        language: { type: 'string', enum: ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'cpp', 'c', 'ruby', 'php', 'csharp'], description: 'Programming language (auto-detected if omitted)' },
        strategy: { type: 'string', enum: ['aggressive', 'balanced', 'preservative', 'semantic', 'adaptive'], description: 'Extraction strategy (default: adaptive)' },
        model: { type: 'string', description: 'Target model for token budgeting' },
        taskType: { type: 'string', enum: ['bug-fix', 'feature-add', 'code-review', 'refactor', 'explain', 'document', 'test-write', 'general'], description: 'What the user is trying to do' },
        taskPrompt: { type: 'string', description: 'The actual user prompt — used for semantic symbol matching' },
        targetTokens: { type: 'number', description: 'Desired token budget for output' },
        maxTokens: { type: 'number', description: 'Hard token limit' },
      },
      required: ['code'],
    },
  },
  {
    name: 'compress_code',
    description: 'Remove comments, blank lines, and unnecessary whitespace from code',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to compress' },
        language: { type: 'string', description: 'Language for comment pattern detection' },
        aggressive: { type: 'boolean', description: 'Enable aggressive minification (default: false)' },
      },
      required: ['code'],
    },
  },
  {
    name: 'count_tokens',
    description: 'Count tokens in a code string using BPE tokenization',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to count tokens in' },
        encoding: { type: 'string', enum: ['cl100k_base', 'p50k_base', 'r50k_base', 'o200k_base'], description: 'Token encoding (default: cl100k_base)' },
      },
      required: ['code'],
    },
  },
  {
    name: 'extract_diff',
    description: 'Extract only the symbols that changed between two versions of a file',
    inputSchema: {
      type: 'object',
      properties: {
        original: { type: 'string', description: 'Original file content' },
        modified: { type: 'string', description: 'Modified file content' },
        language: { type: 'string', description: 'Programming language' },
      },
      required: ['original', 'modified'],
    },
  },
  {
    name: 'parse_code',
    description: 'Parse code and return all extracted symbols with their metadata',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to parse' },
        language: { type: 'string', description: 'Programming language (auto-detected)' },
      },
      required: ['code'],
    },
  },
  {
    name: 'analyze_context',
    description: 'Analyze how efficiently context is being used — breakdown of what\'s kept vs discarded',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to analyze' },
        language: { type: 'string', description: 'Programming language' },
      },
      required: ['code'],
    },
  },
];

// ────────────────────────────────────────────────────────────
// TOOL HANDLERS
// ────────────────────────────────────────────────────────────

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResponse> {
  try {
    switch (toolName) {
      case 'optimize_context': return await handleOptimize(args);
      case 'compress_code': return await handleCompress(args);
      case 'count_tokens': return handleCount(args);
      case 'extract_diff': return await handleDiff(args);
      case 'parse_code': return await handleParse(args);
      case 'analyze_context': return await handleAnalyze(args);
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${msg}` }],
    };
  }
}

// ────────────────────────────────────────────────────────────
// HANDLER IMPLEMENTATIONS
// ────────────────────────────────────────────────────────────

async function handleOptimize(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { optimizeContext } = await import('../extractors/index.js');

  const code = args.code as string;
  if (!code) throw new Error('code is required');

  const result = await optimizeContext(code, {
    language: args.language as Language | undefined,
    strategy: args.strategy as ExtractionStrategy | undefined,
    model: args.model as Model | undefined,
    taskType: args.taskType as TaskType | undefined,
    taskPrompt: args.taskPrompt as string | undefined,
    targetTokens: args.targetTokens as number | undefined,
    maxTokens: args.maxTokens as number | undefined,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          optimized: result.code,
          stats: {
            originalTokens: result.originalTokens,
            optimizedTokens: result.optimizedTokens,
            reductionPercent: result.reductionPercent,
            compressionRatio: result.compressionRatio,
            strategy: result.strategy,
            language: result.language,
            processingTimeMs: result.processingTimeMs,
          },
          symbols: {
            included: result.includedSymbols,
            excluded: result.excludedSymbols,
            total: result.totalSymbolsFound,
          },
          quality: {
            estimatedCompleteness: result.estimatedCompleteness,
            semanticCoverage: result.semanticCoverage,
            callGraphNodes: result.callGraphStats?.totalNodes,
            callGraphEdges: result.callGraphStats?.totalEdges,
          },
        }, null, 2),
      },
    ],
  };
}

async function handleCompress(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { compressFull } = await import('../compressors/index.js');
  const code = args.code as string;
  const aggressive = args.aggressive as boolean;

  const result = compressFull(code, {
    removeComments: true,
    removeBlankLines: true,
    collapseWhitespace: true,
    minify: aggressive,
    preserveLicense: true,
    preserveShebang: true,
  }, args.language as string);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          compressed: result.code,
          stats: {
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            compressionRatio: result.compressionRatio,
            removedPatterns: result.removedPatterns,
          },
        }, null, 2),
      },
    ],
  };
}

async function handleCount(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { Tokenizer } = await import('../tokenizer/index.js');
  const code = args.code as string;
  const encoding = (args.encoding as TokenEncoding) ?? 'cl100k_base';

  const tokenizer = new Tokenizer({ encoding });
  const tokens = tokenizer.count(code);
  const estimate = tokenizer.estimate(code);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tokens,
          characters: estimate.characters,
          words: estimate.words,
          lines: estimate.lines,
          encoding,
        }, null, 2),
      },
    ],
  };
}

async function handleDiff(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { extractDiff } = await import('../extractors/index.js');
  const original = args.original as string;
  const modified = args.modified as string;

  const result = extractDiff(original, modified, {
    language: args.language as Language | undefined,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          diff: result.code,
          stats: {
            originalTokens: result.originalTokens,
            optimizedTokens: result.optimizedTokens,
            reductionPercent: result.reductionPercent,
          },
          changed: result.includedSymbols,
        }, null, 2),
      },
    ],
  };
}

async function handleParse(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { parseCodeSync, detectLanguage } = await import('../parser/index.js');
  const code = args.code as string;
  const language = (args.language as Language) ?? detectLanguage('');

  const symbols = parseCodeSync(code, language);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          language,
          symbolCount: symbols.length,
          symbols: symbols.map(s => ({
            name: s.name,
            type: s.type,
            signature: s.signature,
            isExported: s.isExported,
            startLine: s.startLine,
            endLine: s.endLine,
            lineCount: s.lineCount,
            complexity: s.complexity,
          })),
        }, null, 2),
      },
    ],
  };
}

async function handleAnalyze(args: Record<string, unknown>): Promise<McpToolResponse> {
  const { parseCodeSync, detectLanguage } = await import('../parser/index.js');
  const { buildGraph, getGraphStats } = await import('../graph/index.js');
  const { Tokenizer } = await import('../tokenizer/index.js');

  const code = args.code as string;
  const language = (args.language as Language) ?? detectLanguage('');
  const tokenizer = new Tokenizer();

  const symbols = parseCodeSync(code, language);
  const graph = buildGraph(symbols);
  const stats = getGraphStats(graph);
  const tokenEstimate = tokenizer.estimate(code);

  // Count comment vs code ratio
  const lines = code.split('\n');
  const commentLines = lines.filter(l => /^\s*\/\//.test(l) || /^\s*\*/.test(l) || /^\s*\/\*/.test(l)).length;
  const blankLines = lines.filter(l => l.trim() === '').length;
  const codeLines = lines.length - commentLines - blankLines;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          language,
          fileStats: {
            totalLines: lines.length,
            codeLines,
            commentLines,
            blankLines,
            tokens: tokenEstimate.tokens,
            characters: tokenEstimate.characters,
          },
          symbols: {
            total: symbols.length,
            exported: symbols.filter(s => s.isExported).length,
            byType: Object.entries(
              symbols.reduce((acc: Record<string, number>, s) => {
                acc[s.type] = (acc[s.type] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([type, count]) => ({ type, count })),
          },
          graph: stats,
        }, null, 2),
      },
    ],
  };
}
