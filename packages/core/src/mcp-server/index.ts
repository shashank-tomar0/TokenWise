#!/usr/bin/env node

/**
 * TokenWise MCP Server — stdio-based Model Context Protocol server
 *
 * Run with: npx tokenwise-mcp
 * Or add to any MCP client's config:
 *
 * Claude Code:
 *   {"tokenwise": {"command": "npx", "args": ["tokenwise-mcp"]}}
 *
 * Cursor:
 *   Add as MCP server with command "npx tokenwise-mcp"
 *
 * Provides tools:
 *   - optimize_context     Extract symbols, fit to token budget
 *   - compress_code        Strip comments/whitespace
 *   - count_tokens         Count tokens in code
 *   - extract_diff         Show only changed symbols
 *   - parse_code           List symbols in code
 *   - analyze_context      Full code analysis
 */

import { optimizeContext, compressFull, countTokens, extractDiff, parseCodeSync, detectLanguage, buildGraph, getGraphStats } from '../index.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

const TOOLS = [
  { name: 'optimize_context', description: 'Extract important symbols from code, compressed to fit token budget', inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' }, strategy: { type: 'string' }, taskPrompt: { type: 'string' }, targetTokens: { type: 'number' } }, required: ['code'] } },
  { name: 'compress_code', description: 'Strip comments, blank lines, and whitespace from code', inputSchema: { type: 'object', properties: { code: { type: 'string' }, aggressive: { type: 'boolean' } }, required: ['code'] } },
  { name: 'count_tokens', description: 'Count tokens in code using BPE estimation', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  { name: 'extract_diff', description: 'Extract only changed symbols between two file versions', inputSchema: { type: 'object', properties: { original: { type: 'string' }, modified: { type: 'string' } }, required: ['original', 'modified'] } },
  { name: 'parse_code', description: 'Parse code and return all extracted symbols', inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' } }, required: ['code'] } },
  { name: 'analyze_context', description: 'Full code analysis: lines, tokens, symbols, call graph', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
];

// ────────────────────────────────────────────────────────────
// Tool handlers
// ────────────────────────────────────────────────────────────

async function handleOptimize(args: Record<string, unknown>) {
  const result = await optimizeContext(args.code as string, {
    language: args.language as any,
    strategy: args.strategy as any,
    taskPrompt: args.taskPrompt as string,
    targetTokens: args.targetTokens as number,
  });
  return { content: [{ type: 'text', text: JSON.stringify({ optimized: result.code, stats: { originalTokens: result.originalTokens, optimizedTokens: result.optimizedTokens, reductionPercent: result.reductionPercent, strategy: result.strategy, processingTimeMs: result.processingTimeMs }, symbols: { included: result.includedSymbols, excluded: result.excludedSymbols, total: result.totalSymbolsFound } }, null, 2) }] };
}

async function handleCompress(args: Record<string, unknown>) {
  const result = compressFull(args.code as string, { removeComments: true, removeBlankLines: true, collapseWhitespace: true, minify: !!args.aggressive, preserveLicense: true });
  return { content: [{ type: 'text', text: JSON.stringify({ compressed: result.code, originalSize: result.originalSize, compressedSize: result.compressedSize, ratio: result.compressionRatio, removed: result.removedPatterns }, null, 2) }] };
}

async function handleCount(args: Record<string, unknown>) {
  const tokens = countTokens(args.code as string);
  return { content: [{ type: 'text', text: JSON.stringify({ tokens, encoding: 'cl100k_base' }, null, 2) }] };
}

async function handleDiff(args: Record<string, unknown>) {
  const result = extractDiff(args.original as string, args.modified as string);
  return { content: [{ type: 'text', text: JSON.stringify({ diff: result.code, stats: { originalTokens: result.originalTokens, optimizedTokens: result.optimizedTokens }, changed: result.includedSymbols }, null, 2) }] };
}

async function handleParse(args: Record<string, unknown>) {
  const lang = (args.language as string) ?? detectLanguage('');
  const symbols = parseCodeSync(args.code as string, lang as any);
  return { content: [{ type: 'text', text: JSON.stringify({ language: lang, count: symbols.length, symbols: symbols.map(s => ({ name: s.name, type: s.type, exported: s.isExported, lines: `${s.startLine}-${s.endLine}` })) }, null, 2) }] };
}

async function handleAnalyze(args: Record<string, unknown>) {
  const code = args.code as string;
  const lines = code.split('\n');
  const tokens = countTokens(code);
  const symbols = parseCodeSync(code);
  const graph = buildGraph(symbols);
  const stats = getGraphStats(graph);
  return { content: [{ type: 'text', text: JSON.stringify({ file: { lines: lines.length, tokens, chars: code.length }, symbols: { total: symbols.length, exported: symbols.filter(s => s.isExported).length, byType: Object.entries(symbols.reduce((acc: Record<string, number>, s: any) => { acc[s.type] = (acc[s.type] ?? 0) + 1; return acc; }, {})).map(([t, c]) => ({ type: t, count: c })) }, graph: stats }, null, 2) }] };
}

// ────────────────────────────────────────────────────────────
// JSON-RPC over stdio
// ────────────────────────────────────────────────────────────

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<any>> = {
  optimize_context: handleOptimize,
  compress_code: handleCompress,
  count_tokens: handleCount,
  extract_diff: handleDiff,
  parse_code: handleParse,
  analyze_context: handleAnalyze,
};

let buf = '';
let rid = 0;

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const req = JSON.parse(t);
      handle(req).catch(e => sendErr(req.id ?? `r${++rid}`, -32603, String(e)));
    } catch { sendErr(`r${++rid}`, -32700, 'Parse error'); }
  }
});

process.stdin.on('end', () => process.exit(0));

async function handle(req: any) {
  const id = req.id ?? `r${++rid}`;
  switch (req.method) {
    case 'initialize':
      respond(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'tokenwise-mcp', version: '0.1.0' } });
      break;
    case 'notifications/initialized':
      break;
    case 'tools/list':
      respond(id, { tools: TOOLS });
      break;
    case 'tools/call': {
      const { name, arguments: args } = req.params ?? {};
      if (!name || !HANDLERS[name]) { sendErr(id, -32601, `Unknown tool: ${name}`); return; }
      const result = await HANDLERS[name](args ?? {});
      respond(id, result);
      break;
    }
    default: respond(id, {});  // no-op for unknown methods
  }
}

function respond(id: any, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendErr(id: any, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

process.stderr.write('TokenWise MCP server ready on stdio\n');
