// fleet-session-topology.ts — visualize inter-session communication and dependency
// patterns. builds a directed graph of session relationships from deps, shared
// files, event flow, and knowledge transfer. renders ASCII topology view.
// zero dependencies.

/** edge type in the topology */
export type EdgeType = "dependency" | "shared-file" | "event-flow" | "knowledge" | "conflict";

/** a directed edge between sessions */
export interface TopologyEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight: number;           // strength of connection (1-10)
  label?: string;
}

/** a node in the topology */
export interface TopologyNode {
  session: string;
  inDegree: number;         // edges pointing TO this session
  outDegree: number;        // edges pointing FROM this session
  totalDegree: number;
  isHub: boolean;           // high degree = hub
  isLeaf: boolean;          // degree 1 = leaf
  isIsolated: boolean;      // degree 0 = no connections
}

/** topology analysis */
export interface TopologyResult {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  clusters: string[][];      // groups of connected sessions
  hubSessions: string[];     // high-connectivity sessions
  isolatedSessions: string[];
  density: number;           // edge count / max possible edges (0-1)
}

/** build topology from session data */
export function buildTopology(
  sessions: string[],
  deps: { from: string; to: string }[],
  sharedFiles: { session1: string; session2: string; file: string }[],
  eventFlows: { from: string; to: string; event: string }[],
  knowledgeTransfers: { from: string; to: string }[],
  conflicts: { session1: string; session2: string }[],
): TopologyResult {
  const edges: TopologyEdge[] = [];

  // dependency edges
  for (const d of deps) {
    edges.push({ from: d.from, to: d.to, type: "dependency", weight: 5 });
  }

  // shared file edges (bidirectional, use lower weight)
  for (const sf of sharedFiles) {
    edges.push({ from: sf.session1, to: sf.session2, type: "shared-file", weight: 3, label: sf.file });
  }

  // event flow edges
  for (const ef of eventFlows) {
    edges.push({ from: ef.from, to: ef.to, type: "event-flow", weight: 2, label: ef.event });
  }

  // knowledge transfer edges
  for (const kt of knowledgeTransfers) {
    edges.push({ from: kt.from, to: kt.to, type: "knowledge", weight: 4 });
  }

  // conflict edges (bidirectional)
  for (const c of conflicts) {
    edges.push({ from: c.session1, to: c.session2, type: "conflict", weight: 7 });
  }

  // deduplicate edges (same from+to+type → keep highest weight)
  const edgeMap = new Map<string, TopologyEdge>();
  for (const e of edges) {
    const key = `${e.from}→${e.to}:${e.type}`;
    const existing = edgeMap.get(key);
    if (!existing || e.weight > existing.weight) {
      edgeMap.set(key, e);
    }
  }
  const dedupedEdges = [...edgeMap.values()];

  // compute node metrics
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const s of sessions) { inDegree.set(s, 0); outDegree.set(s, 0); }
  for (const e of dedupedEdges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const avgDegree = sessions.length > 0
    ? [...inDegree.values()].reduce((s, v) => s + v, 0) / sessions.length +
      [...outDegree.values()].reduce((s, v) => s + v, 0) / sessions.length
    : 0;
  const hubThreshold = Math.max(3, avgDegree * 1.5);

  const nodes: TopologyNode[] = sessions.map((s) => {
    const inD = inDegree.get(s) ?? 0;
    const outD = outDegree.get(s) ?? 0;
    const total = inD + outD;
    return {
      session: s,
      inDegree: inD,
      outDegree: outD,
      totalDegree: total,
      isHub: total >= hubThreshold,
      isLeaf: total === 1,
      isIsolated: total === 0,
    };
  });

  // find connected clusters via BFS
  const clusters = findClusters(sessions, dedupedEdges);

  // compute density
  const maxEdges = sessions.length * (sessions.length - 1); // directed
  const density = maxEdges > 0 ? Math.round((dedupedEdges.length / maxEdges) * 1000) / 1000 : 0;

  return {
    nodes: nodes.sort((a, b) => b.totalDegree - a.totalDegree),
    edges: dedupedEdges,
    clusters,
    hubSessions: nodes.filter((n) => n.isHub).map((n) => n.session),
    isolatedSessions: nodes.filter((n) => n.isIsolated).map((n) => n.session),
    density,
  };
}

/** find connected clusters using BFS on undirected adjacency */
function findClusters(sessions: string[], edges: TopologyEdge[]): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const s of sessions) adj.set(s, new Set());
  for (const e of edges) {
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const s of sessions) {
    if (visited.has(s)) continue;
    const cluster: string[] = [];
    const queue = [s];
    visited.add(s);
    while (queue.length > 0) {
      const node = queue.shift()!;
      cluster.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    clusters.push(cluster);
  }

  return clusters.sort((a, b) => b.length - a.length);
}

/** format topology for TUI display */
export function formatTopology(result: TopologyResult): string[] {
  const lines: string[] = [];
  lines.push(`session topology: ${result.nodes.length} nodes, ${result.edges.length} edges, density=${result.density}`);
  lines.push(`  clusters: ${result.clusters.length} | hubs: ${result.hubSessions.length} | isolated: ${result.isolatedSessions.length}`);

  // edge type breakdown
  const byType = new Map<string, number>();
  for (const e of result.edges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  if (byType.size > 0) {
    lines.push(`  edge types: ${[...byType.entries()].map(([t, n]) => `${t}(${n})`).join(", ")}`);
  }

  // hubs
  if (result.hubSessions.length > 0) {
    lines.push(`  hubs: ${result.hubSessions.join(", ")}`);
  }

  // render mini topology
  const topNodes = result.nodes.slice(0, 8);
  if (topNodes.length > 0) {
    lines.push("  topology:");
    for (const node of topNodes) {
      const tag = node.isHub ? " [HUB]" : node.isIsolated ? " [isolated]" : node.isLeaf ? " [leaf]" : "";
      const outEdges = result.edges.filter((e) => e.from === node.session);
      lines.push(`    ${node.session} (in=${node.inDegree} out=${node.outDegree})${tag}`);
      for (const e of outEdges.slice(0, 3)) {
        const sym = { dependency: "──▶", "shared-file": "◀─▶", "event-flow": "~~▶", knowledge: "··▶", conflict: "✗─✗" }[e.type];
        lines.push(`      ${sym} ${e.to} [${e.type}]`);
      }
      if (outEdges.length > 3) {
        lines.push(`      ... +${outEdges.length - 3} more`);
      }
    }
  }

  // isolated sessions
  if (result.isolatedSessions.length > 0) {
    lines.push(`  isolated: ${result.isolatedSessions.join(", ")}`);
  }

  return lines;
}
