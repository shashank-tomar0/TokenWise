/**
 * TokenWise Semantic Relevance — TF-IDF symbol ranking
 *
 * Ranks code symbols by how relevant they are to a user's natural-language
 * prompt, going beyond the substring keyword matching in findRelevantSymbols.
 *
 * Model: each symbol is treated as a document built from its name, its
 * signature, and its source body. Name terms are weighted ×3 because
 * identifiers are the strongest signal of what a symbol does. Documents are
 * scored against the prompt with classic TF-IDF weighting plus cosine
 * similarity, so symbols that share vocabulary with the prompt rank highest.
 */

import type { Symbol } from '../types.js';

// ════════════════════════════════════════════════════════════
// STOPWORDS
// ════════════════════════════════════════════════════════════

/** Common English stopwords removed from both prompts and documents. */
const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'this', 'that', 'it',
  'do', 'does', 'did', 'how', 'what', 'why', 'where', 'which', 'who',
]);

// ════════════════════════════════════════════════════════════
// TOKENIZATION
// ════════════════════════════════════════════════════════════

/**
 * Split text into lowercase content tokens.
 *
 * Lowercases the input, splits on non-word characters, and drops common
 * English stopwords. Used for both user prompts and symbol documents.
 *
 * @param text  Raw text to tokenize
 * @returns     Content tokens in document order (duplicates preserved)
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(token => token.length > 0 && !STOPWORDS.has(token));
}

// ════════════════════════════════════════════════════════════
// VECTOR SPACE MODEL
// ════════════════════════════════════════════════════════════

/**
 * Count term frequencies in a token list.
 *
 * @param tokens  Tokens, possibly with duplicates
 * @returns       Map of term → occurrence count
 */
export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/**
 * Compute the inverse document frequency of each term across a corpus
 * of symbol documents.
 *
 *   idf(t) = ln((N + 1) / (df(t) + 1)) + 1
 *
 * where N is the number of documents and df(t) is the number of documents
 * containing term t. The +1 smoothing prevents division by zero and
 * down-weights terms that appear in every symbol.
 *
 * @param symbolDocs  Map of symbolId → term frequency map
 * @returns           Map of term → idf weight
 */
export function inverseDocumentFrequency(
  symbolDocs: Map<string, Map<string, number>>,
): Map<string, number> {
  const docCount = symbolDocs.size;

  // Document frequency per term
  const df = new Map<string, number>();
  for (const doc of symbolDocs.values()) {
    for (const term of doc.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

/**
 * Cosine similarity between two term vectors.
 *
 * Returns 1 for identical vectors, 0 for orthogonal vectors, and 0 when
 * either vector is empty.
 *
 * @param vecA  First term vector
 * @param vecB  Second term vector
 * @returns     Cosine similarity in [0, 1]
 */
export function cosineSimilarity(
  vecA: Map<string, number>,
  vecB: Map<string, number>,
): number {
  if (vecA.size === 0 || vecB.size === 0) return 0;

  let dot = 0;
  // Iterate over the smaller vector for efficiency
  const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  for (const [term, weight] of smaller) {
    const other = larger.get(term);
    if (other !== undefined) dot += weight * other;
  }

  let normA = 0;
  for (const weight of vecA.values()) normA += weight * weight;
  let normB = 0;
  for (const weight of vecB.values()) normB += weight * weight;

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ════════════════════════════════════════════════════════════
// INDEX CONSTRUCTION
// ════════════════════════════════════════════════════════════

/**
 * A semantic index over a set of code symbols.
 */
export interface SemanticIndex {
  /** The symbols being indexed, in original order. */
  symbols: Symbol[];
  /** symbolId → term → tfidf weight. */
  docs: Map<string, Map<string, number>>;
  /** term → inverse document frequency. */
  idf: Map<string, number>;
}

/** Body preview length used when building symbol documents. */
const DOC_BODY_PREVIEW_CHARS = 500;

/** Weight multiplier for terms found in a symbol's name. */
const NAME_TERM_WEIGHT = 3;

/**
 * Build a TF-IDF index from code symbols.
 *
 * Each symbol's document is built from its name (weighted ×3), its
 * signature, and the first 500 characters of its source body.
 *
 * @param symbols  Symbols to index
 * @returns        SemanticIndex with per-symbol tfidf documents
 */
export function createSemanticIndex(symbols: Symbol[]): SemanticIndex {
  // Raw term frequencies first — needed to compute document frequencies
  const rawTf = new Map<string, Map<string, number>>();

  for (const symbol of symbols) {
    const tf = new Map<string, number>();

    // Name terms get extra weight — identifiers describe intent
    for (const term of tokenizeText(symbol.name)) {
      tf.set(term, (tf.get(term) ?? 0) + NAME_TERM_WEIGHT);
    }

    // Signature + body preview describe the implementation
    const bodyPreview = symbol.fullSource.slice(0, DOC_BODY_PREVIEW_CHARS);
    for (const term of tokenizeText(`${symbol.signature} ${bodyPreview}`)) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }

    rawTf.set(symbol.id, tf);
  }

  const idf = inverseDocumentFrequency(rawTf);

  // Convert raw frequencies to tfidf weights
  const docs = new Map<string, Map<string, number>>();
  for (const [symbolId, tf] of rawTf) {
    const tfidf = new Map<string, number>();
    for (const [term, count] of tf) {
      const weight = idf.get(term);
      if (weight !== undefined) tfidf.set(term, count * weight);
    }
    docs.set(symbolId, tfidf);
  }

  return { symbols, docs, idf };
}

// ════════════════════════════════════════════════════════════
// RANKING
// ════════════════════════════════════════════════════════════

/** A symbol paired with its semantic relevance score. */
export interface SymbolScore {
  symbol: Symbol;
  score: number;
}

/**
 * Score every symbol in an index against a natural-language prompt.
 *
 * The prompt is tokenized and weighted with the index's idf, then each
 * symbol document is compared via cosine similarity. Results are sorted
 * descending. An empty prompt yields a score of 0 for every symbol, so the
 * original symbol order is preserved (stable sort).
 *
 * @param index   Semantic index built from the symbols
 * @param prompt  The user's natural-language prompt
 * @returns       Every symbol with its similarity score, sorted descending
 */
export function scoreSymbols(index: SemanticIndex, prompt: string): SymbolScore[] {
  const queryTf = termFrequency(tokenizeText(prompt));

  // Terms absent from the corpus can't match any document — skip them
  const queryVec = new Map<string, number>();
  for (const [term, count] of queryTf) {
    const idf = index.idf.get(term);
    if (idf !== undefined) queryVec.set(term, count * idf);
  }

  return index.symbols
    .map(symbol => {
      const docVec = index.docs.get(symbol.id) ?? new Map<string, number>();
      return { symbol, score: cosineSimilarity(queryVec, docVec) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Rank symbols by semantic relevance to a prompt — one-shot helper.
 *
 * @param symbols  Symbols to rank
 * @param prompt   The user's natural-language prompt
 * @returns        Symbols sorted by relevance, most relevant first
 */
export function rankBySemantics(symbols: Symbol[], prompt: string): Symbol[] {
  const index = createSemanticIndex(symbols);
  return scoreSymbols(index, prompt).map(({ symbol }) => symbol);
}

/**
 * Find the symbols most similar to a given symbol.
 *
 * Useful for answering "what else touches this?" — e.g. finding sibling
 * functions that share vocabulary with a symbol the user is editing.
 *
 * @param index     Semantic index to search
 * @param symbolId  ID of the seed symbol (excluded from results)
 * @param topN      Maximum number of related symbols to return (default 5)
 * @returns         Related symbols sorted by similarity, most similar first
 */
export function findRelatedSymbols(
  index: SemanticIndex,
  symbolId: string,
  topN = 5,
): Symbol[] {
  const targetVec = index.docs.get(symbolId);
  if (!targetVec || targetVec.size === 0) return [];

  return index.symbols
    .filter(symbol => symbol.id !== symbolId)
    .map(symbol => ({
      symbol,
      score: cosineSimilarity(
        targetVec,
        index.docs.get(symbol.id) ?? new Map<string, number>(),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ symbol }) => symbol);
}
