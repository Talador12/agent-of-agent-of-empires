// fleet-federation.ts — coordinate across multiple aoaoe daemons via HTTP.
// each daemon exposes a lightweight status endpoint; the federation client
// aggregates fleet state across hosts for unified monitoring.

export interface FederationPeer {
  name: string;
  url: string;          // e.g., "http://host2:4098"
  lastSeenAt?: number;
  status: "online" | "offline" | "unknown";
}

export interface FederatedFleetState {
  peer: string;
  sessions: number;
  activeTasks: number;
  fleetHealth: number;
  totalCostUsd: number;
  lastUpdatedAt: number;
}

export interface FederationOverview {
  peers: FederatedFleetState[];
  totalSessions: number;
  totalActiveTasks: number;
  averageHealth: number;
  totalCostUsd: number;
}

/**
 * Fetch fleet state from a peer daemon's health endpoint.
 */
export async function fetchPeerState(peer: FederationPeer, timeoutMs = 5000): Promise<FederatedFleetState | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${peer.url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    return {
      peer: peer.name,
      sessions: (data.sessions as number) ?? 0,
      activeTasks: (data.activeTasks as number) ?? 0,
      fleetHealth: (data.fleetHealth as number) ?? 0,
      totalCostUsd: (data.totalCostUsd as number) ?? 0,
      lastUpdatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Aggregate fleet state from all peers into an overview.
 */
export function aggregateFederation(states: FederatedFleetState[]): FederationOverview {
  const totalSessions = states.reduce((s, p) => s + p.sessions, 0);
  const totalActiveTasks = states.reduce((s, p) => s + p.activeTasks, 0);
  const totalCost = states.reduce((s, p) => s + p.totalCostUsd, 0);
  const avgHealth = states.length > 0
    ? Math.round(states.reduce((s, p) => s + p.fleetHealth, 0) / states.length)
    : 0;

  return { peers: states, totalSessions, totalActiveTasks, averageHealth: avgHealth, totalCostUsd: totalCost };
}

/**
 * Format federation overview for TUI display.
 */
export function formatFederationOverview(overview: FederationOverview): string[] {
  if (overview.peers.length === 0) return ["  (no federation peers configured)"];
  const lines: string[] = [];
  lines.push(`  Federation: ${overview.peers.length} peers, ${overview.totalSessions} sessions, health ${overview.averageHealth}/100, $${overview.totalCostUsd.toFixed(2)} total`);
  for (const p of overview.peers) {
    const age = Math.round((Date.now() - p.lastUpdatedAt) / 60_000);
    lines.push(`  ${p.peer}: ${p.sessions} sessions, ${p.activeTasks} active, health ${p.fleetHealth}/100, $${p.totalCostUsd.toFixed(2)} (${age}m ago)`);
  }
  return lines;
}
