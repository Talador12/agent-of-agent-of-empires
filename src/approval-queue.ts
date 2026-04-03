// approval-queue.ts — batch pending decisions for async human review.
// when the daemon is in confirm mode or has low-confidence decisions,
// queues them for the operator to approve/reject in bulk.

export interface PendingApproval {
  id: string;
  timestamp: number;
  sessionTitle: string;
  actionType: string;
  detail: string;
  confidence: "high" | "medium" | "low";
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface ApprovalQueueConfig {
  maxPending: number;       // max queued items before auto-expiring oldest (default: 50)
  expiryMs: number;         // auto-expire after this duration (default: 30min)
}

const DEFAULT_CONFIG: ApprovalQueueConfig = {
  maxPending: 50,
  expiryMs: 30 * 60_000,
};

let nextId = 1;

/**
 * Manage an operator approval queue for daemon decisions.
 */
export class ApprovalQueue {
  private items: PendingApproval[] = [];
  private config: ApprovalQueueConfig;

  constructor(config: Partial<ApprovalQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Queue a decision for approval. Returns the approval ID. */
  enqueue(sessionTitle: string, actionType: string, detail: string, confidence: PendingApproval["confidence"] = "medium", now = Date.now()): string {
    this.expire(now);
    const id = `approval-${nextId++}`;
    this.items.push({ id, timestamp: now, sessionTitle, actionType, detail, confidence, status: "pending" });
    // enforce max pending
    const pending = this.items.filter((i) => i.status === "pending");
    if (pending.length > this.config.maxPending) {
      pending[0].status = "expired";
    }
    return id;
  }

  /** Approve a queued decision by ID. */
  approve(id: string): boolean {
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return false;
    item.status = "approved";
    return true;
  }

  /** Reject a queued decision by ID. */
  reject(id: string): boolean {
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return false;
    item.status = "rejected";
    return true;
  }

  /** Approve all pending items. Returns count approved. */
  approveAll(): number {
    let count = 0;
    for (const item of this.items) {
      if (item.status === "pending") { item.status = "approved"; count++; }
    }
    return count;
  }

  /** Reject all pending items. Returns count rejected. */
  rejectAll(): number {
    let count = 0;
    for (const item of this.items) {
      if (item.status === "pending") { item.status = "rejected"; count++; }
    }
    return count;
  }

  /** Get all pending items. */
  getPending(now = Date.now()): PendingApproval[] {
    this.expire(now);
    return this.items.filter((i) => i.status === "pending");
  }

  /** Get approved items that haven't been consumed yet. */
  consumeApproved(): PendingApproval[] {
    const approved = this.items.filter((i) => i.status === "approved");
    // remove consumed items
    this.items = this.items.filter((i) => i.status !== "approved");
    return approved;
  }

  /** Get queue statistics. */
  getStats(): { pending: number; approved: number; rejected: number; expired: number; total: number } {
    const counts = { pending: 0, approved: 0, rejected: 0, expired: 0, total: this.items.length };
    for (const i of this.items) {
      if (i.status in counts) (counts as Record<string, number>)[i.status]++;
    }
    return counts;
  }

  /** Format queue for TUI display. */
  formatQueue(now = Date.now()): string[] {
    const pending = this.getPending(now);
    if (pending.length === 0) return ["  (no pending approvals)"];
    const lines: string[] = [];
    lines.push(`  Approval queue: ${pending.length} pending:`);
    for (const p of pending) {
      const age = Math.round((now - p.timestamp) / 60_000);
      const conf = p.confidence === "high" ? "●" : p.confidence === "medium" ? "◐" : "○";
      lines.push(`  ${conf} [${p.id}] ${p.sessionTitle}: ${p.actionType} — ${p.detail} (${age}m ago)`);
    }
    lines.push(`  Use /approve <id|all> or /reject <id|all>`);
    return lines;
  }

  private expire(now: number): void {
    const cutoff = now - this.config.expiryMs;
    for (const item of this.items) {
      if (item.status === "pending" && item.timestamp < cutoff) {
        item.status = "expired";
      }
    }
  }
}
