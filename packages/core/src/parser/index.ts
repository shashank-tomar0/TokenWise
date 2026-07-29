/**
 * TokenWise Parser — multi-language code parser with tree-sitter AST support
 *
 * Architecture:
 *   layer 1: tree-sitter WASM (high-fidelity AST, best results)
 *   layer 2: regex-based fallback (works everywhere, ~85% accuracy)
 *
 * The parser auto-selects the best available layer and caches
 * the tree-sitter language module after first load.
 */

import type { Language, Symbol, SymbolType, ImportStatement, ExportStatement, Diagnostic, ParserConfig } from '../types.js';

// ════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ════════════════════════════════════════════════════════════

const EXT_MAP: Record<string, Language> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java', class: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  c: 'c', h: 'c',
  php: 'php', phtml: 'php',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
};

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? 'typescript';
}

// ════════════════════════════════════════════════════════════
// REGEX-BASED PARSER (FALLBACK)
// ════════════════════════════════════════════════════════════

interface LangPatterns {
  comment: RegExp;
  docComment: RegExp;
  importPattern: RegExp;
  classDef: RegExp;
  functionDef: RegExp;
  interfaceDef: RegExp;
  typeDef: RegExp;
  enumDef: RegExp;
  methodDef: RegExp;
  propertyDef: RegExp;
  constructorDef: RegExp;
  moduleDef: RegExp;
  variableDef: RegExp;
  decoratorDef: RegExp;
}

const LANG_PATTERNS: Record<string, LangPatterns> = {
  typescript: {
    comment:     /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    docComment:  /\/\*\*[\s\S]*?\*\//g,
    importPattern: /(?:import|export)\s+(?:type\s+)?(?:\{[\s\S]*?\}|[\w*{}, \n]+?)\s+from\s+['"]([^'"]+?)['"]|import\s+['"]([^'"]+?)['"]/g,
    classDef:    /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[\w.]+(?:<[^>]*>)?)?(?:\s+implements\s+[\w.,\s<>.]+)?\s*\{/gm,
    functionDef: /(?:export\s+)?(?:async\s+)?function\s+(?:\*?\s*)(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
    interfaceDef: /(?:export\s+)?(?:abstract\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[\w.,\s<>.]+)?\s*\{/gm,
    typeDef:     /(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/g,
    enumDef:     /(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/g,
    methodDef:   /(?:public|private|protected|static|async|override|\s)*(?:\*\s*)?(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
    propertyDef: /(?:public|private|protected|static|readonly)\s+(\w+)(?:\?)?\s*(?::\s*[^=;]+)?(?:\s*=\s*[^;]+)?;/gm,
    constructorDef: /constructor\s*\([^)]*\)\s*\{/g,
    moduleDef:   /(?:declare\s+)?module\s+['"][^'"]+['"]\s*\{/g,
    variableDef: /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=;]+)?(?:\s*=\s*[^;]*)?;/g,
    decoratorDef: /@\w+(?:\.\w+)?(?:\([^)]*\))?/g,
  },
  javascript: {
    comment:     /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    docComment:  /\/\*\*[\s\S]*?\*\//g,
    importPattern: /(?:import|export)\s+(?:\{[^}]+\}|[\w*{}, \n]+?)\s+from\s+['"]([^'"]+?)['"]|require\(['"]([^'"]+?)['"]\)/g,
    classDef:    /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/gm,
    functionDef: /(?:export\s+)?(?:async\s+)?function\s+(?:\*\s*)?(\w+)\s*\([^)]*\)\s*\{/gm,
    interfaceDef: /(?:export\s+)?interface\s+(\w+)\s*\{/g,
    typeDef:     /(?:export\s+)?type\s+(\w+)\s*=/g,
    enumDef:     /(?:export\s+)?enum\s+(\w+)\s*\{/g,
    methodDef:   /(\w+)\s*\([^)]*\)\s*\{/gm,
    propertyDef: /(\w+)\s*:\s*[^,;]+,?/gm,
    constructorDef: /constructor\s*\([^)]*\)\s*\{/g,
    moduleDef:   /(?:export\s+)?module\s+['"][^'"]+['"]\s*\{/g,
    variableDef: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=;]+)?\s*=\s*[^;]*;/g,
    decoratorDef: /@\w+(?:\([^)]*\))?/g,
  },
  python: {
    comment:     /#.*$/gm,
    docComment:  /"""(?:[^"]|"(?!")|""(?!"))*?"""|'''(?:[^']|'(?!')|''(?!'))*?'''/g,
    importPattern: /(?:from\s+(\w+(?:\.\w+)*)\s+import\s+(.+)|import\s+(\w+(?:\.\w+)*))/g,
    classDef:    /class\s+(\w+)(?:\([^)]*\))?:/gm,
    functionDef: /(?:async\s+)?def\s+(\w+)\s*\([^)]*\)\s*(?:->\s*[^:]+)?:/gm,
    interfaceDef: /class\s+(\w+)/g, // Python uses ABCs, not interfaces
    typeDef:     /^(\w+)\s*=\s*(?:Union|Optional|List|Dict|Set|Tuple|Type\[)/gm,
    enumDef:     /class\s+(\w+)\((?:\w*Enum|IntEnum)\):/gm,
    methodDef:   /(?:async\s+)?def\s+(\w+)\s*\(self[^)]*\)\s*(?:->\s*[^:]+)?:/gm,
    propertyDef: /@property\s*\n\s*def\s+(\w+)/gm,
    constructorDef: /def\s+__init__\s*\([^)]*\):/g,
    moduleDef:   /\/\/ (?:module|namespace)/,
    variableDef: /^([a-z_]\w*)\s*=\s*(?:['"]|True|False|None|\d+)/gm,
    decoratorDef: /@\w+(?:\.\w+)?(?:\([^)]*\))?/g,
  },
  go: {
    comment:     /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    docComment:  /\/\/.*$/gm,
    importPattern: /import\s+(?:\([^)]*\)|"[^"]+")/g,
    classDef:    /type\s+(\w+)\s+struct\s*\{/gm,
    functionDef: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:\([^)]*\))?\s*(?:\w+\s*(?:\([^)]*\))?)?\s*\{/gm,
    interfaceDef: /type\s+(\w+)\s+interface\s*\{/gm,
    typeDef:     /type\s+(\w+)\s+(?:\[\]?\w+|map\[|\*?\w+)/gm,
    enumDef:     /type\s+(\w+)\s+=/g,
    methodDef:   /func\s+\([^)]+\)\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)/gm,
    propertyDef: /(\w+)\s+(?:\[\]?\w+|\*\w+)/gm,
    constructorDef: /func\s+New\w+\s*\([^)]*\)/g,
    moduleDef:   /package\s+\w+/g,
    variableDef: /var\s+(?:\(|(\w+))\s/g,
    decoratorDef: /@\w+/g,
  },
  rust: {
    comment:     /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    docComment:  /\/\/\/.*$|\/\/!.*$/gm,
    importPattern: /use\s+([a-zA-Z_][\w:]*(?:\s+as\s+\w+)?)(?:::\{[^}]*\})?;/g,
    classDef:    /(?:pub\s+)?struct\s+(\w+)(?:<[^>]*>)?(?:\s*\{|;)/gm,
    functionDef: /(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*(?:where\s[^{]+)?\s*\{/gm,
    interfaceDef: /(?:pub\s+)?trait\s+(\w+)(?:<[^>]*>)?(?:\s*:[\s\w+]*)?\s*\{/gm,
    typeDef:     /(?:pub\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/g,
    enumDef:     /(?:pub\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{/gm,
    methodDef:   /(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->\s*[^{]+)?\s*(?:where\s[^{]+)?\s*\{/gm,
    propertyDef: /(\w+)\s*:\s*[^,}]+/gm,
    constructorDef: /fn\s+new\s*\([^)]*\)/g,
    moduleDef:   /(?:pub\s+)?mod\s+(\w+)(?:\s*\{|;)/gm,
    variableDef: /(?:let\s+(?:mut\s+)?)(\w+)/g,
    decoratorDef: /#\[[^\]]*\]/g,
  },
  java: {
    comment:     /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    docComment:  /\/\*\*[\s\S]*?\*\//g,
    importPattern: /import\s+([\w.*]+);/g,
    classDef:    /(?:public|private|protected)?\s*(?:abstract|final|static)?\s*class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+\w+(?:<[^>]*>)?)?(?:\s+implements\s+[\w.,\s<>]+)?\s*\{/gm,
    functionDef: /(?:public|private|protected)?\s*(?:static\s+)?(?:<[^>]+>\s*)?[\w[\]]+\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*(?:throws\s+\w+(?:,\s*\w+)*)?\s*\{/gm,
    interfaceDef: /(?:public|private|protected)?\s*interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[\w.,\s<>]+)?\s*\{/gm,
    typeDef:     /(?:public|private|protected)?\s*(?:abstract\s+)?class\s+(\w+)/g,
    enumDef:     /(?:public\s+)?enum\s+(\w+)(?:\s+implements\s+[\w.,\s<>]+)?\s*\{/gm,
    methodDef:   /(?:public|private|protected)?\s*(?:static\s+)?(?:<[^>]+>\s*)?[\w[\]]+\s+(\w+)(?:<[^>]*>)?\s*\([^)]*\)\s*\{/gm,
    propertyDef: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[\w[\]]+\s+(\w+)\s*(?:=\s*[^;]+)?;/gm,
    constructorDef: /(?:public|private|protected)?\s*(\w+)\s*\([^)]*\)\s*\{/g,
    moduleDef:   /module\s+\w+/g,
    variableDef: /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[\w[\]]+\s+(\w+)\s*=/g,
    decoratorDef: /@\w+(?:\([^)]*\))?/g,
  },
};

// Language-common patterns (used for dynamic lookups)
const SYMBOL_TYPE_MAP: Record<string, SymbolType> = {
  functionDef: 'function',
  methodDef: 'method',
  classDef: 'class',
  interfaceDef: 'interface',
  typeDef: 'typeAlias',
  enumDef: 'enum',
  variableDef: 'variable',
  propertyDef: 'property',
  constructorDef: 'constructor',
  moduleDef: 'module',
};

// ════════════════════════════════════════════════════════════
// BODY MATCHING — finds closing brace for bracket-delimited blocks
// ════════════════════════════════════════════════════════════

/**
 * Find the matching closing brace for a code block starting at openBraceIdx.
 * Handles nested braces and string/comment literals.
 */
function findMatchingBrace(code: string, openBraceIdx: number): number {
  if (code[openBraceIdx] !== '{') return openBraceIdx;

  let depth = 1;
  let i = openBraceIdx + 1;
  const len = code.length;

  while (i < len && depth > 0) {
    const ch = code[i];
    // Skip strings
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < len) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) break;
        i++;
      }
    }
    // Skip comments
    if (code[i] === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }
  return i; // position after the closing brace
}

/**
 * Get the full body of a function/class/interface from a pattern match.
 * Returns the declaration line + body content.
 */
function extractBody(code: string, matchIdx: number, matchLength: number): string {
  const searchStart = matchIdx + matchLength;
  // The regex already consumed the opening { — find the next { after match
  // Actually the regex pattern often INCLUDEs { in the match (e.g. functionDef)
  // So the { is at searchStart-1 when the match ends with }
  // Check if we need to find a new { or the match already consumed it
  const endsWithOpen = code[searchStart - 1] === '{';
  if (endsWithOpen) {
    // { is at searchStart-1, find matching }
    const closeIdx = findMatchingBrace(code, searchStart - 1);
    return code.slice(matchIdx, closeIdx).trim();
  }
  const braceIdx = code.indexOf('{', searchStart);
  if (braceIdx === -1) return code.slice(matchIdx, searchStart).trim();
  const closeIdx = findMatchingBrace(code, braceIdx);
  return code.slice(matchIdx, closeIdx).trim();
}

// ════════════════════════════════════════════════════════════
// REGEX EXTRACTION
// ════════════════════════════════════════════════════════════

let symbolIdCounter = 0;

function extractViaRegex(code: string, language: Language): Symbol[] {
  const symbols: Symbol[] = [];
  const patterns = LANG_PATTERNS[language];
  if (!patterns) return symbols;

  const lines = code.split('\n');

  // Helper to extract symbol from a regex match
  function addSymbol(
    patternKey: keyof LangPatterns,
    match: RegExpExecArray,
    typeOverride?: SymbolType,
  ) {
    const name = match[1] || match[2] || match[3] || 'anonymous';
    const startOffset = match.index;
    const startLine = code.slice(0, startOffset).split('\n').length;

    // Find the full body (declaration + block)
    let fullSource: string;
    const matchLen = match[0].length;
    const afterMatch = code.slice(startOffset + matchLen);

    if (afterMatch.trimStart().startsWith('{') || afterMatch.includes('{')) {
      fullSource = extractBody(code, startOffset, matchLen);
    } else if (language === 'python' && match[0].endsWith(':')) {
      // Python — body is indented lines after the colon
      const bodyLines: string[] = [];
      let j = startLine; // 1-indexed
      while (j < lines.length) {
        const nextLine = lines[j];
        if (!nextLine || nextLine.trim() === '' || (nextLine.startsWith(' ') || nextLine.startsWith('\t'))) {
          bodyLines.push(nextLine);
          j++;
        } else if (nextLine.trim().startsWith('def ') || nextLine.trim().startsWith('class ') || nextLine.trim() === '' || j === startLine) {
          j++;
        } else break;
      }
      const declEnd = code.indexOf('\n', startOffset);
      const decl = declEnd === -1 ? code.slice(startOffset) : code.slice(startOffset, declEnd);
      fullSource = decl + '\n' + bodyLines.join('\n');
    } else {
      fullSource = match[0];
    }

    const endLine = code.slice(0, startOffset + fullSource.length).split('\n').length;
    const isExported = match[0].includes('export') || match[0].includes('pub ');

    // Generate unique ID
    const type = typeOverride ?? (SYMBOL_TYPE_MAP[patternKey] ?? 'function');
    const id = `${type}:${name}:${symbolIdCounter++}`;

    symbols.push({
      id,
      name,
      type,
      filePath: '',
      range: {
        start: { line: startLine, column: 0, offset: startOffset },
        end: { line: endLine, column: 0, offset: startOffset + fullSource.length },
      },
      startLine,
      endLine,
      signature: match[0].includes('{')
        ? match[0].replace(/\s*\{.*$/, '').replace(/\s*:\s*$/, '').trim() + ' { ... }'
        : match[0].replace(/\s*:\s*$/, '').trim().replace(/;\s*$/, '') + ';',
      fullSource,
      visibility: match[0].includes('private') ? 'private'
        : match[0].includes('protected') ? 'protected'
        : 'public',
      isExported,
      isAsync: match[0].includes('async'),
      isGenerator: match[0].includes('*'),
      dependencies: [],
      dependents: [],
      importStatements: [],
      importanceScore: 0,
      callCount: 0,
      lineCount: endLine - startLine + 1,
      complexity: 1,
      parameters: [],
      parent: undefined,
      children: [],
    });
  }

  // Pattern keys in extraction order (most important first)
  const patternKeys: (keyof LangPatterns)[] = [
    'classDef', 'interfaceDef', 'functionDef', 'enumDef',
    'typeDef', 'methodDef', 'constructorDef', 'moduleDef',
    'propertyDef', 'variableDef',
  ];

  for (const key of patternKeys) {
    const re = new RegExp(patterns[key].source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) {
      // Skip if this match is inside a string or comment (simple check)
      const preceding = code.slice(0, match.index);
      const quotesBefore = (preceding.match(/["'`]/g) || []).length;
      if (quotesBefore % 2 !== 0) continue;
      addSymbol(key, match);
    }
  }

  return symbols;
}

// ════════════════════════════════════════════════════════════
// TREE-SITTER PARSER (when WASM is available)
// ════════════════════════════════════════════════════════════

interface TreeSitterAPI {
  Language: { load: (wasmBytes: Uint8Array) => unknown };
  Parser: new () => { setLanguage: (lang: unknown) => void; parse: (code: string) => TreeSitterTree };
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  childCount: number;
  namedChildCount: number;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
  parent: TreeSitterNode | null;
  firstChild: TreeSitterNode | null;
  lastChild: TreeSitterNode | null;
  nextSibling: TreeSitterNode | null;
  previousSibling: TreeSitterNode | null;
  child(field: number): TreeSitterNode | null;
  childForFieldName(field: string): TreeSitterNode | null;
  namedChild(idx: number): TreeSitterNode | null;
}

// Tree-sitter WASM grammar name lookup
const TS_LANG_NAMES: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  cpp: 'tree-sitter-cpp',
  c: 'tree-sitter-c',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  csharp: 'tree-sitter-csharp',
};

let tsModule: TreeSitterAPI | null = null;
let tsLoading: Promise<void> | null = null;

async function loadTreeSitter(): Promise<TreeSitterAPI | null> {
  if (tsModule) return tsModule;
  if (tsLoading) { await tsLoading; return tsModule; }

  tsLoading = (async () => {
    try {
      const mod = await import('web-tree-sitter');
      // web-tree-sitter exports a Parser constructor and a Language class.
      // The module itself serves as the API — no separate init() needed.
      if (mod) {
        tsModule = mod as unknown as TreeSitterAPI;
      }
    } catch {
      tsModule = null;
    }
  })();
  await tsLoading;
  return tsModule;
}

// Lazy cache for loaded language objects
const loadedLanguages = new Map<string, unknown>();

async function loadTSLanguage(language: Language): Promise<unknown | null> {
  const langName = TS_LANG_NAMES[language];
  if (!langName) return null;
  if (loadedLanguages.has(language)) return loadedLanguages.get(language);

  try {
    // Try loading via WASM path convention
    const wasmUrl = `${langName}.wasm`;
    const mod = await loadTreeSitter();
    if (!mod) return null;

    let response: Response;
    try {
      response = await fetch(wasmUrl);
    } catch {
      // Try loading from node_modules
      const path = require.resolve(`${langName}/wasm/${langName}.wasm`);
      const fs = await import('fs');
      const buf = fs.readFileSync(path);
      loadedLanguages.set(language, mod.Language.load(buf));
      return loadedLanguages.get(language);
    }

    if (!response.ok) return null;
    const buf = await response.arrayBuffer();
    loadedLanguages.set(language, mod.Language.load(new Uint8Array(buf)));
    return loadedLanguages.get(language);
  } catch {
    return null;
  }
}

async function extractViaTreeSitter(code: string, language: Language): Promise<Symbol[] | null> {
  const api = await loadTreeSitter();
  if (!api) return null;

  const tsLang = await loadTSLanguage(language);
  if (!tsLang) return null;

  try {
    const parser = new api.Parser();
    parser.setLanguage(tsLang);
    const tree = parser.parse(code);
    const symbols: Symbol[] = [];

    // Walk the tree and collect symbols
    function collectSymbols(node: TreeSitterNode, parent?: string): void {
      const type = node.type;

      // Map tree-sitter node types to our SymbolType
      const symbolType = nodeTypeToSymbolType(type, language);
      if (symbolType) {
        // Extract name from child nodes
        let name = '';
        const nameNode = node.childForFieldName('name')
          || node.namedChildren.find(c => ['identifier', 'property_identifier', 'type_identifier'].includes(c.type));
        if (nameNode) name = nameNode.text;

        // For variable declarations, look deeper
        if (!name && (type === 'lexical_declaration' || type === 'variable_declaration')) {
          const declarator = node.namedChildren.find(c => c.type === 'variable_declarator');
          if (declarator) {
            const declName = declarator.childForFieldName('name');
            if (declName) name = declName.text;
          }
        }

        if (name) {
          const id = `${symbolType}:${name}:${symbolIdCounter++}`;
          const source = node.text;

          // Determine if exported (check modifiers in tree)
          let isExported = false;
          let visibility: 'public' | 'private' | 'protected' | 'internal' = 'public';

          // Check parent nodes for export/visibility modifiers
          let parent_ = node.parent;
          while (parent_) {
            const ptype: string = parent_.type;
            if (ptype === 'export_statement' || ptype === 'export_specifier') {
              isExported = true;
            } else if (ptype === 'private') {
              visibility = 'private';
            } else if (ptype === 'protected') {
              visibility = 'protected';
            }
            parent_ = parent_.parent;
          }

          // Detect async
          const isAsync = source.includes('async') || node.type.includes('async');

          symbols.push({
            id,
            name,
            type: symbolType,
            filePath: '',
            range: {
              start: { line: node.startPosition.row + 1, column: node.startPosition.column, offset: node.startIndex },
              end: { line: node.endPosition.row + 1, column: node.endPosition.column, offset: node.endIndex },
            },
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature: source.split('{')[0].trim() + ' { ... }',
            fullSource: source,
            visibility,
            isExported,
            isAsync,
            isGenerator: type.includes('generator') || type.includes('yield'),
            dependencies: [],
            dependents: [],
            importStatements: [],
            importanceScore: 0,
            callCount: 0,
            lineCount: node.endPosition.row - node.startPosition.row + 1,
            complexity: 1,
            parameters: [],
            parent,
            children: [],
          });
        }
      }

      // Recurse into children
      for (const child of node.namedChildren) {
        collectSymbols(child, parent || (symbolType ? undefined : parent));
      }
    }

    collectSymbols(tree.rootNode);
    return symbols.length > 0 ? symbols : null;
  } catch {
    return null;
  }
}

function nodeTypeToSymbolType(nodeType: string, _language: Language): SymbolType | null {
  switch (nodeType) {
    case 'function_declaration':
    case 'function_definition':
    case 'function_item':
      return 'function';
    case 'method_definition':
    case 'method_declaration':
      return 'method';
    case 'arrow_function':
      return 'arrowFunction';
    case 'class_declaration':
    case 'class_definition':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
    case 'type_alias':
    case 'type_item':
      return 'typeAlias';
    case 'enum_declaration':
    case 'enum_item':
      return 'enum';
    case 'lexical_declaration':
    case 'variable_declaration':
      return 'constant';
    case 'property_declaration':
    case 'field_declaration':
      return 'property';
    case 'constructor':
    case 'constructor_declaration':
      return 'constructor';
    case 'module_declaration':
      return 'module';
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════
// IMPORT/EXTRACT EXTRACTION
// ════════════════════════════════════════════════════════════

function extractImports(code: string, language: Language): ImportStatement[] {
  const patterns = LANG_PATTERNS[language];
  if (!patterns) return [];

  const imports: ImportStatement[] = [];
  const re = new RegExp(patterns.importPattern.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(code)) !== null) {
    const stmt = match[0];
    const fromPath = match[1] || match[2] || match[3] || '';
    if (!fromPath) continue;

    // Parse named imports
    const namedMatch = stmt.match(/\{\s*([^}]+?)\s*\}/);
    const named = namedMatch
      ? namedMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      : [];

    // Default import
    const defaultMatch = stmt.match(/import\s+(\w+)\s+from/);
    const isTypeOnly = stmt.includes('import type') || stmt.includes('export type');
    const isSideEffect = stmt.match(/^import\s+['"]/);

    imports.push({
      path: fromPath.replace(/^['"]|['"]$/g, ''),
      named,
      default: defaultMatch?.[1],
      isTypeOnly,
      isSideEffect: !!isSideEffect,
    });
  }

  return imports;
}

function extractExports(code: string, _language: Language): ExportStatement[] {
  const exports: ExportStatement[] = [];

  // Named exports
  const namedRe = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = namedRe.exec(code)) !== null) {
    exports.push({
      names: [match[1]],
      isReExport: false,
      isDefault: false,
      isTypeOnly: match[0].includes('interface') || match[0].includes('type '),
    });
  }

  // Default exports
  if (code.includes('export default')) {
    const defaultRe = /export\s+default\s+(?:function|class|const|let|var)?\s*(\w+)?/g;
    while ((match = defaultRe.exec(code)) !== null) {
      exports.push({
        names: match[1] ? [match[1]] : ['default'],
        isReExport: false,
        isDefault: true,
        isTypeOnly: false,
      });
    }
  }

  // Re-exports
  const reExportRe = /export\s+(?:\{[^}]+\})\s+from\s+['"]([^'"]+?)['"]/g;
  while ((match = reExportRe.exec(code)) !== null) {
    exports.push({ names: [], isReExport: true, from: match[1], isDefault: false, isTypeOnly: false });
  }

  return exports;
}

// ════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════

export interface ParserResult {
  symbols: Symbol[];
  imports: ImportStatement[];
  exports: ExportStatement[];
  diagnostics: Diagnostic[];
  parseTimeMs: number;
  treeSitterUsed: boolean;
}

/**
 * Parse code and extract all symbols.
 *
 * Uses tree-sitter WASM when available (high accuracy), falls back
 * to regex-based extraction (good enough for most use cases).
 *
 * @param code       The source code to parse
 * @param language   Programming language
 * @param config     Optional parser config
 */
export async function parseCode(
  code: string,
  language: Language = 'typescript',
  config?: Partial<ParserConfig>,
): Promise<ParserResult> {
  const startTime = performance.now();
  const diagnostics: Diagnostic[] = [];
  let symbols: Symbol[] | null = null;
  let treeSitterUsed = false;

  if (!code || code.trim().length === 0) {
    return { symbols: [], imports: [], exports: [], diagnostics: [], parseTimeMs: 0, treeSitterUsed: false };
  }

  // Try tree-sitter first
  if (!config?.parseTimeoutMs || config.parseTimeoutMs > 0) {
    try {
      const tsSymbols = await extractViaTreeSitter(code, language);
      if (tsSymbols && tsSymbols.length > 0) {
        symbols = tsSymbols;
        treeSitterUsed = true;
      }
    } catch {
      // tree-sitter unavailable, fall through to regex
    }
  }

  // Fall back to regex
  if (!symbols) {
    symbols = extractViaRegex(code, language);
    if (symbols.length === 0) {
      diagnostics.push({
        level: 'warning',
        code: 'NO_SYMBOLS',
        message: `No symbols found in ${language} code. The code may use patterns the parser doesn't recognize.`,
        suggestion: 'Check that the language is correct. Try tree-sitter for better results.',
      });
    }
  }

  // Extract imports and exports
  const imports = extractImports(code, language);
  const exports = extractExports(code, language);

  // Assign import statements to symbols
  for (const symbol of symbols) {
    symbol.importStatements = imports
      .filter(imp => code.slice(0, code.indexOf(symbol.fullSource)).includes(imp.path))
      .map(imp => `import ${imp.default ? `${imp.default}, ` : ''}${imp.named.length ? `{ ${imp.named.join(', ')} }` : ''} from '${imp.path}'`);
  }

  const parseTimeMs = Math.round(performance.now() - startTime);

  return {
    symbols,
    imports,
    exports,
    diagnostics,
    parseTimeMs,
    treeSitterUsed,
  };
}

/**
 * Synchronous parse using regex only (no tree-sitter needed).
 * Useful for quick analysis or environments where WASM isn't available.
 */
export function parseCodeSync(code: string, language: Language = 'typescript'): Symbol[] {
  return extractViaRegex(code, language);
}

/**
 * Detect symbols relevant to a given prompt using basic name matching.
 */
export function findRelevantSymbols(symbols: Symbol[], prompt: string): Symbol[] {
  if (!prompt || !symbols.length) return symbols;

  const promptLower = prompt.toLowerCase();
  const tokens = promptLower.split(/\W+/).filter(t => t.length > 2);

  return symbols
    .map(sym => {
      const nameLower = sym.name.toLowerCase();
      const relevanceTokens = tokens.filter(t =>
        nameLower.includes(t) || t.includes(nameLower)
      ).length;
      return { symbol: sym, relevance: relevanceTokens };
    })
    .filter(({ relevance }) => relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .map(({ symbol }) => symbol);
}

// ════════════════════════════════════════════════════════════
// LANGUAGE TOOLING
// ════════════════════════════════════════════════════════════

const LANG_NAMES: Record<Language, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python',
  go: 'Go', rust: 'Rust', java: 'Java', cpp: 'C++', c: 'C',
  ruby: 'Ruby', php: 'PHP', csharp: 'C#', swift: 'Swift', kotlin: 'Kotlin',
};

export function getLanguageDisplayName(language: Language): string {
  return LANG_NAMES[language] ?? language;
}

export function supportsTreeSitter(language: Language): boolean {
  return language in TS_LANG_NAMES;
}
