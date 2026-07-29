/**
 * TokenWise Compressors — multi-strategy code compression
 *
 * Provides layered compression:
 *   1. Light: whitespace + blank-line removal
 *   2. Standard: comments + light
 *   3. Aggressive: standard + minification + identifier shortening
 *   4. Smart: preserves important patterns (JSDoc, license, TODO)
 */

import type { CompressionOptions, CompressionResult } from '../types.js';

// ────────────────────────────────────────────────────────────
// DEFAULTS
// ────────────────────────────────────────────────────────────

export const DEFAULT_COMPRESSION_OPTIONS: CompressionOptions = {
  removeComments: true,
  removeBlankLines: true,
  collapseWhitespace: true,
  minify: false,
  removeConsoleLogs: false,
  removeDebugCode: false,
  removeDeadCode: false,
  preserveShebang: true,
  preserveLicense: true,
  preserveImportantComments: true,
  importantCommentPatterns: ['TODO|FIXME|HACK|XXX|NOTE|OPTIMIZE|WORKAROUND'],
  collapseObjectLiterals: false,
  shortenIdentifiers: false,
  removeTypeAnnotations: false,
};

// ────────────────────────────────────────────────────────────
// STRING/COMMENT PROTECTION
// ────────────────────────────────────────────────────────────

const STRING_RE = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g;
const TEMPLATE_LITERAL_RE = /`(?:[^`\\]|\\.)*`/g;

/**
 * Protect string literals during compression so that content
 * inside strings isn't mistakenly removed/altered.
 */
function protectStrings(code: string): { protected: string; strings: string[] } {
  const strings: string[] = [];
  const protectedCode = code
    .replace(STRING_RE, (m) => {
      strings.push(m);
      return `\x00STR${strings.length - 1}\x00`;
    })
    .replace(TEMPLATE_LITERAL_RE, (m) => {
      strings.push(m);
      return `\x00STR${strings.length - 1}\x00`;
    });
  return { protected: protectedCode, strings };
}

function restoreStrings(code: string, strings: string[]): string {
  return strings.reduce(
    (acc, str, i) => acc.replace(`\x00STR${i}\x00`, str),
    code,
  );
}

// ────────────────────────────────────────────────────────────
// HELPER: language-aware comment regex
// ────────────────────────────────────────────────────────────

const LANG_COMMENT_RE: Record<string, { single: RegExp; multi: RegExp }> = {
  python:  { single: /#.*$/gm, multi: /(""")[\s\S]*?\1|(''')[\s\S]*?\1/g },
  ruby:    { single: /#.*$/gm, multi: /=begin[\s\S]*?=end/g },
  haskell: { single: /--.*$/gm, multi: /\{-\s*[\s\S]*?-\}/g },
};

function getCommentPatterns(language?: string) {
  return LANG_COMMENT_RE[language ?? ''] ?? {
    single: /\/\/.*$/gm,
    multi: /\/\*[\s\S]*?\*\//g,
  };
}

// ────────────────────────────────────────────────────────────
// COMPRESSION FUNCTIONS
// ────────────────────────────────────────────────────────────

/**
 * Compress code with the specified options.
 */
export function compress(
  code: string,
  options: Partial<CompressionOptions> = {},
  language?: string,
): string {
  const opts = { ...DEFAULT_COMPRESSION_OPTIONS, ...options };
  if (!code) return code;

  let result = code;

  // 🔒 Protect string literals
  const { protected: protectedCode, strings } = protectStrings(result);

  // ── 1. Remove comments ──
  if (opts.removeComments) {
    result = removeComments(protectedCode, opts, language);
  } else {
    result = protectedCode;
  }

  // ── 2. Remove debug code (console.log, debugger, etc.) ──
  if (opts.removeConsoleLogs) {
    result = result.replace(/console\.\w+\([^)]*\);?\s*/g, '');
  }
  if (opts.removeDebugCode) {
    result = result.replace(/debugger;?\s*/g, '');
    // Python debug
    result = result.replace(/import\s+pdb;?\s*pdb\.set_trace\(\)/g, '');
  }

  // ── 3. Remove blank lines ──
  if (opts.removeBlankLines) {
    result = result.replace(/^\s*[\r\n]/gm, '');
  }

  // ── 4. Collapse whitespace ──
  if (opts.collapseWhitespace && !opts.minify) {
    // Collapse multiple spaces to one, preserve indentation
    result = result.replace(/[ \t]{2,}/g, ' ');
  }

  // ── 5. Remove dead code ──
  if (opts.removeDeadCode) {
    // Remove unreachable code after return/throw/break/continue
    result = result.replace(/\b(return|throw|break|continue)\b[^;]*;\s*[^}\s][^;]*;/g, '$1;');
  }

  // ── 6. Aggressive minification ──
  if (opts.minify) {
    result = minify(result, opts);
  }

  // 🔓 Restore string literals
  result = restoreStrings(result, strings);

  return result.trim();
}

/**
 * Aggressive minification for maximum compression.
 */
function minify(code: string, opts: CompressionOptions): string {
  let result = code;

  // Collapse all whitespace runs → single space
  result = result.replace(/\s+/g, ' ');

  // Remove space around structural tokens
  result = result.replace(/\s*([{}();,:])\s*/g, '$1');

  // Remove unnecessary optional spaces around operators (keep for regex safety)
  result = result.replace(/\s*([+\-*/%=<>!&|^~?])\s*/g, '$1');

  // Remove trailing semicolons (safe except for loop headers)
  result = result.replace(/;}/g, '}');
  result = result.replace(/;$/gm, '');

  if (opts.collapseObjectLiterals) {
    // Minimize object/array literal spacing
    result = result.replace(/\{\s+/g, '{');
    result = result.replace(/\s+\}/g, '}');
    result = result.replace(/\[\s+/g, '[');
    result = result.replace(/\s+\]/g, ']');
  }

  return result;
}

/**
 * Remove comments from code, with important-comment preservation.
 */
function removeComments(code: string, opts: CompressionOptions, language?: string): string {
  const patterns = getCommentPatterns(language);
  let result = code;

  // Collect important comments to preserve
  const importantPatterns = [
    ...(opts.importantCommentPatterns ?? []),
    '@license', '@preserve', '@copyright', '(c)',
  ];
  const preserved: string[] = [];
  if (opts.preserveImportantComments) {
    for (const pattern of importantPatterns) {
      const re = new RegExp(`\\/\\/[\\s\\S]*?${pattern}[\\s\\S]*?(?:\\n|$)`, 'gi');
      let m;
      while ((m = re.exec(code)) !== null) preserved.push(m[0]);
      const re2 = new RegExp(`\\/\\*[\\s\\S]*?${pattern}[\\s\\S]*?\\*\\/`, 'gi');
      while ((m = re2.exec(code)) !== null) preserved.push(m[0]);
    }
  }

  // Remove single-line comments
  result = result.replace(patterns.single, '');

  // Remove multi-line comments
  result = result.replace(patterns.multi, '');

  // Restore preserved important comments
  for (const comment of preserved) {
    const safeKey = `__PRESERVED_${preserved.indexOf(comment)}__`;
    result = result.replace(safeKey, comment);
  }

  // Trim trailing whitespace from each line (left by comment removal)
  result = result.split('\n').map(l => l.trimEnd()).join('\n');

  return result;
}

// ────────────────────────────────────────────────────────────
// SMART COMPRESSION — preserves important patterns
// ────────────────────────────────────────────────────────────

export function smartCompress(
  code: string,
  options: Partial<CompressionOptions> = {},
  language?: string,
): string {
  if (!code) return code;

  // Preserve shebang
  let shebang = '';
  if (options.preserveShebang !== false && code.startsWith('#!')) {
    const nl = code.indexOf('\n');
    shebang = code.slice(0, nl + 1);
  }

  // Run compression
  let result = compress(code, options, language);

  // Find JSDoc-style comments that survived
  const docComments: string[] = [];
  const docRe = /\/\*\*[\s\S]*?\*\//g;
  let m;
  while ((m = docRe.exec(code)) !== null) {
    if (m[0].includes('@param') || m[0].includes('@returns') || m[0].includes('@example')) {
      docComments.push(m[0]);
    }
  }

  return shebang + result;
}

// ────────────────────────────────────────────────────────────
// COMPRESSION ESTIMATOR
// ────────────────────────────────────────────────────────────

export function estimateCompression(
  code: string,
  options: Partial<CompressionOptions> = {},
): CompressionResult['removedPatterns'] {
  const counts: Record<string, number> = {
    comment: 0,
    blankLine: 0,
    whitespace: 0,
    consoleLog: 0,
    debugCode: 0,
  };

  if (options.removeComments !== false) {
    counts.comment = (code.match(/\/\/.*$/gm) || []).length +
      (code.match(/\/\*[\s\S]*?\*\//g) || []).length;
  }
  if (options.removeBlankLines) {
    counts.blankLine = (code.match(/^\s*$/gm) || []).length;
  }
  if (options.removeConsoleLogs) {
    counts.consoleLog = (code.match(/console\.\w+/g) || []).length;
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({
      type,
      count,
      estimatedTokensSaved: count * 3, // rough estimate: ~3 tokens per item
    }));
}

/**
 * Full compression pipeline: compress + estimation stats.
 */
export function compressFull(
  code: string,
  options: Partial<CompressionOptions> = {},
  language?: string,
): CompressionResult {
  const originalSize = code.length;
  const removedPatterns = estimateCompression(code, options);
  const compressedCode = smartCompress(code, options, language);
  const compressedSize = compressedCode.length;

  return {
    code: compressedCode,
    originalSize,
    compressedSize,
    compressionRatio: compressedSize > 0 ? originalSize / compressedSize : 1,
    removedPatterns,
  };
}
