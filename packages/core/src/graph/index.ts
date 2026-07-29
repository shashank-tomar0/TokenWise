/**
 * TokenWise Symbol Graph Engine
 *
 * Builds a directed dependency graph from parsed symbols using call-site
 * analysis, import tracking, and inheritance resolution.
 *
 * The graph enables:
 *   - PageRank-style centrality scoring
 *   - Critical path identification (hot paths from entry points)
 *   - Cluster detection for related symbols
 *   - Budget-aware traversal for optimal context selection
 */

import type { Symbol, SymbolGraph, SymbolNode, SymbolEdge, EdgeType } from '../types.js';

// ────────────────────────────────────────────────────────────
// GRAPH BUILD OPTIONS
// ────────────────────────────────────────────────────────────

export interface GraphBuildOptions {
  /** Max traversal depth from entry points. 0 = unlimited */
  maxDepth: number;
  /** Entry point symbol names (e.g. exported APIs or user-named) */
  entryPoints?: string[];
  /** Regex to ignore symbols by name (e.g. internal helpers) */
  ignorePattern?: RegExp;
  /** Include import-based edges */
  includeImports: boolean;
  /** Include inheritance edges (extends, implements) */
  includeInheritance: boolean;
}

const DEFAULT_GRAPH_OPTIONS: GraphBuildOptions = {
  maxDepth: 5,
  includeImports: true,
  includeInheritance: true,
};

// ────────────────────────────────────────────────────────────
// MAIN GRAPH BUILDER
// ────────────────────────────────────────────────────────────

/**
 * Build a directed dependency graph from a symbol set.
 *
 * Edge detection strategy:
 *   1. **Import edges**: symbol A imports from the file where B lives  → A → B
 *   2. **Reference edges**: symbol A's source text mentions B by name → A → B
 *   3. **Inheritance edges**: class A extends B → A → B
 *   4. **Type edges**: interface A extends B → A → B
 */
export function buildGraph(
  symbols: Symbol[],
  options: Partial<GraphBuildOptions> = {},
): SymbolGraph {
  const opts = { ...DEFAULT_GRAPH_OPTIONS, ...options };
  const nodes = new Map<string, SymbolNode>();
  const edges: SymbolEdge[] = [];
  const nameToIds = new Map<string, string[]>();

  // ── 1. Index symbols by name ──
  for (const sym of symbols) {
    if (opts.ignorePattern?.test(sym.name)) continue;
    const existing = nameToIds.get(sym.name) ?? [];
    existing.push(sym.id);
    nameToIds.set(sym.name, existing);
  }

  // ── 2. Create nodes ──
  for (const sym of symbols) {
    if (opts.ignorePattern?.test(sym.name)) continue;
    nodes.set(sym.id, {
      id: sym.id,
      symbol: sym,
      centrality: 0,
      fanIn: 0,
      fanOut: 0,
      clusterId: -1,
      pageRank: 0,
      depth: 0,
    });
  }

  // ── 3. Detect edges ──

  // Helper: add an edge (deduped by from → to → type)
  const edgeSet = new Set<string>();
  function addEdge(from: string, to: string, type: EdgeType, weight: number = 1) {
    if (from === to) return;
    const key = `${from}::${to}::${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    edges.push({ from, to, type, weight });
    const fromNode = nodes.get(from);
    const toNode = nodes.get(to);
    if (fromNode) { fromNode.fanOut++; fromNode.depth = 0; }
    if (toNode) { toNode.fanIn++; toNode.depth = 0; }
  }

  // 3a. Import edges: symbols from the same file form a module cluster
  const fileSymbols = new Map<string, Symbol[]>();
  for (const sym of symbols) {
    const file = sym.filePath || '__inline__';
    const group = fileSymbols.get(file) ?? [];
    group.push(sym);
    fileSymbols.set(file, group);
  }

  // Build intra-file reference edges (symbol A calls/uses symbol B within same file)
  for (const sym of symbols) {
    if (opts.ignorePattern?.test(sym.name)) continue;
    const source = sym.fullSource;
    const sourceLower = source.toLowerCase();

    // Check against every other symbol
    for (const [otherName, ids] of nameToIds) {
      if (otherName === sym.name) continue;
      if (sourceLower.includes(otherName.toLowerCase()) ||
          source.includes(otherName)) {
        for (const toId of ids) {
          if (nodes.has(sym.id) && nodes.has(toId)) {
            addEdge(sym.id, toId, 'call');
          }
        }
      }
    }
  }

  // 3b. Inheritance edges
  if (opts.includeInheritance) {
    for (const sym of symbols) {
      const source = sym.fullSource;
      const extendsMatch = source.match(/extends\s+([\w.]+)/);
      if (extendsMatch) {
        const parentName = extendsMatch[1];
        const parentIds = nameToIds.get(parentName);
        if (parentIds) {
          for (const pid of parentIds) {
            addEdge(sym.id, pid, 'inheritance', 2);
          }
        }
      }
      const implementsMatch = source.match(/implements\s+([\w.,\s]+)/);
      if (implementsMatch) {
        const ifaces = implementsMatch[1].split(',').map(s => s.trim());
        for (const iface of ifaces) {
          const ifaceIds = nameToIds.get(iface);
          if (ifaceIds) {
            for (const iid of ifaceIds) {
              addEdge(sym.id, iid, 'implementation', 1.5);
            }
          }
        }
      }
    }
  }

  // ── 4. Calculate PageRank-style centrality ──
  calculatePageRank(nodes, edges);

  // ── 5. Cluster detection (simple connected-components) ──
  const visited = new Set<string>();
  let clusterId = 0;

  for (const [nodeId] of nodes) {
    if (visited.has(nodeId)) continue;
    // BFS cluster assignment
    const queue = [nodeId];
    visited.add(nodeId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.get(current);
      if (node) node.clusterId = clusterId;

      for (const edge of edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
        if (edge.to === current && !visited.has(edge.from)) {
          visited.add(edge.from);
          queue.push(edge.from);
        }
      }
    }
    clusterId++;
  }

  // ── 6. Assign depth from entry points ──
  if (opts.entryPoints && opts.entryPoints.length > 0) {
    calculateDepth(nodes, edges, opts.entryPoints, opts.maxDepth);
  }

  return { nodes, edges };
}

// ────────────────────────────────────────────────────────────
// PAGERANK
// ────────────────────────────────────────────────────────────

function calculatePageRank(
  nodes: Map<string, SymbolNode>,
  edges: SymbolEdge[],
  iterations: number = 20,
  damping: number = 0.85,
): void {
  const N = nodes.size;
  if (N === 0) return;

  const pr = new Map<string, number>();
  const initialRank = 1 / N;

  for (const [id] of nodes) pr.set(id, initialRank);

  // Build outgoing adjacency
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const newPR = new Map<string, number>();
    let danglingSum = 0;

    // Sum ranks of dangling nodes (no outgoing edges)
    for (const [id] of nodes) {
      if (!outgoing.has(id) || outgoing.get(id)!.length === 0) {
        danglingSum += pr.get(id)! / N;
      }
    }

    for (const [id] of nodes) {
      let sum = 0;
      // Find all edges pointing to this node
      for (const edge of edges) {
        if (edge.to === id) {
          const outLen = outgoing.get(edge.from)?.length ?? 0;
          if (outLen > 0) {
            sum += (pr.get(edge.from)! / outLen) * edge.weight;
          }
        }
      }
      newPR.set(id, (1 - damping) / N + damping * (sum + danglingSum));
    }

    for (const [id, rank] of newPR) pr.set(id, rank);
  }

  // Assign normalized ranks to nodes
  for (const [id, rank] of pr) {
    const node = nodes.get(id);
    if (node) node.pageRank = rank;
  }
}

// ────────────────────────────────────────────────────────────
// DEPTH CALCULATION FROM ENTRY POINTS
// ────────────────────────────────────────────────────────────

function calculateDepth(
  nodes: Map<string, SymbolNode>,
  edges: SymbolEdge[],
  entryPoints: string[],
  maxDepth: number,
): void {
  // Find entry node IDs by name
  const entryIds = new Set<string>();
  for (const [id, node] of nodes) {
    if (entryPoints.includes(node.symbol.name)) {
      entryIds.add(id);
    }
  }
  if (entryIds.size === 0) return;

  // BFS from entry points
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const eid of entryIds) {
    queue.push({ id: eid, depth: 0 });
    visited.add(eid);
  }

  while (queue.length > 0) {
    const { id: currentId, depth } = queue.shift()!;
    const node = nodes.get(currentId);
    if (node) node.depth = depth;

    if (maxDepth > 0 && depth >= maxDepth) continue;

    // Traverse outgoing edges (callee direction)
    for (const edge of edges) {
      if (edge.from === currentId && !visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
    // Also traverse incoming edges (caller direction)
    for (const edge of edges) {
      if (edge.to === currentId && !visited.has(edge.from)) {
        visited.add(edge.from);
        queue.push({ id: edge.from, depth: depth + 1 });
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// GRAPH QUERIES
// ────────────────────────────────────────────────────────────

export interface GraphQueryResult {
  path: string[];
  totalWeight: number;
  depth: number;
}

/**
 * Find all paths from a source symbol to a target symbol (BFS shortest).
 */
export function findShortestPath(
  graph: SymbolGraph,
  fromName: string,
  toName: string,
): GraphQueryResult[] {
  const fromIds = findNodeIdsByName(graph, fromName);
  const toIds = findNodeIdsByName(graph, toName);
  if (fromIds.length === 0 || toIds.length === 0) return [];

  const results: GraphQueryResult[] = [];

  for (const fromId of fromIds) {
    for (const toId of toIds) {
      // BFS
      const visited = new Set<string>();
      const queue: Array<{ id: string; path: string[]; weight: number }> = [
        { id: fromId, path: [fromId], weight: 0 },
      ];
      visited.add(fromId);

      while (queue.length > 0) {
        const { id, path, weight } = queue.shift()!;
        if (id === toId) {
          const nodeNames = path.map(nid => graph.nodes.get(nid)?.symbol.name ?? nid);
          results.push({
            path: nodeNames,
            totalWeight: weight,
            depth: path.length - 1,
          });
          break; // BFS finds shortest first
        }

        for (const edge of graph.edges) {
          if (edge.from === id && !visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push({
              id: edge.to,
              path: [...path, edge.to],
              weight: weight + edge.weight,
            });
          }
          // Also traverse reverse for bidirectionality
          if (edge.to === id && !visited.has(edge.from)) {
            visited.add(edge.from);
            queue.push({
              id: edge.from,
              path: [...path, edge.from],
              weight: weight + edge.weight,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Get the "hot path" — the highest-traffic symbol chain starting from
 * the most central node.
 */
export function findHotPath(graph: SymbolGraph): string[] {
  if (graph.nodes.size === 0) return [];

  // Find the most central node
  let maxCentrality = -1;
  let centralId = '';
  for (const [id, node] of graph.nodes) {
    if (node.pageRank > maxCentrality) {
      maxCentrality = node.pageRank;
      centralId = id;
    }
  }
  if (!centralId) return [];

  // Walk the highest-weighted outgoing path
  const path: string[] = [centralId];
  const visited = new Set<string>([centralId]);
  let current = centralId;

  while (true) {
    const outgoing = graph.edges
      .filter(e => e.from === current && !visited.has(e.to))
      .sort((a, b) => b.weight - a.weight);

    if (outgoing.length === 0) break;

    const next = outgoing[0].to;
    visited.add(next);
    path.push(next);
    current = next;

    if (path.length > 20) break; // safety limit
  }

  return path.map(id => graph.nodes.get(id)?.symbol.name ?? id);
}

/**
 * Find symbols that have no incoming or outgoing edges (isolated).
 */
export function findOrphanedSymbols(graph: SymbolGraph): SymbolNode[] {
  const orphans: SymbolNode[] = [];
  for (const [, node] of graph.nodes) {
    const hasIncoming = graph.edges.some(e => e.to === node.id);
    const hasOutgoing = graph.edges.some(e => e.from === node.id);
    if (!hasIncoming && !hasOutgoing) {
      orphans.push(node);
    }
  }
  return orphans;
}

/**
 * Get all entry-point candidates: exported symbols with no incoming edges.
 */
export function findEntryCandidates(graph: SymbolGraph): SymbolNode[] {
  const candidates: SymbolNode[] = [];
  for (const [, node] of graph.nodes) {
    if (node.symbol.isExported) {
      const hasIncoming = graph.edges.some(e => e.to === node.id);
      if (!hasIncoming) candidates.push(node);
    }
  }
  return candidates;
}

/**
 * Calculate graph statistics.
 */
export function getGraphStats(graph: SymbolGraph) {
  const clusters = new Set<number>();
  for (const [, node] of graph.nodes) clusters.add(node.clusterId);

  const edgesByType = new Map<string, number>();
  for (const edge of graph.edges) {
    edgesByType.set(edge.type, (edgesByType.get(edge.type) ?? 0) + 1);
  }

  return {
    totalNodes: graph.nodes.size,
    totalEdges: graph.edges.length,
    clusters: clusters.size,
    edgeTypes: Object.fromEntries(edgesByType),
    avgPageRank: graph.nodes.size > 0
      ? [...graph.nodes.values()].reduce((s, n) => s + n.pageRank, 0) / graph.nodes.size
      : 0,
  };
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

function findNodeIdsByName(graph: SymbolGraph, name: string): string[] {
  const ids: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.symbol.name === name) ids.push(id);
  }
  return ids;
}
