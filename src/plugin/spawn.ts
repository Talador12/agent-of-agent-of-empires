// Spawn one session per open GitHub issue — the most-requested orchestrator
// feature in aoe issue #553. Reads issues via the `gh` CLI (process.spawn
// grant), creates sessions via the host's `sessions.create` RPC.
//
// Safety posture, in order:
//   - dry-run unless spawn_live is enabled: reports the plan, creates nothing
//   - capped by spawn_limit per run and max_active_sessions overall
//     (the host additionally caps plugin sessions at 5 and creates at 20/hr)
//   - idempotency_key "issue:<repo>#<number>" means retries and repeat runs
//     can never double-spawn a session for the same issue
//   - initial_turn carries the issue title/body/url as the session's goal

import { exec } from "../shell.js";
import type { HostClient } from "./host.js";
import type { PluginSettings } from "./settings.js";

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface SpawnOutcome {
  issue: GithubIssue;
  planned: boolean; // dry-run: would have spawned
  created: boolean; // live: sessions.create returned created=true
  sessionId?: string;
  skippedReason?: string;
}

export interface SpawnReport {
  repo: string;
  live: boolean;
  outcomes: SpawnOutcome[];
  error?: string;
}

const ISSUE_FETCH_TIMEOUT_MS = 30_000;

export async function listOpenIssues(repo: string, label: string, limit: number): Promise<GithubIssue[]> {
  const args = ["issue", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", "number,title,body,url"];
  if (label) args.push("--label", label);
  const res = await exec("gh", args, ISSUE_FETCH_TIMEOUT_MS);
  if (res.exitCode !== 0) {
    throw new Error(`gh issue list failed (${res.exitCode}): ${res.stderr.trim() || res.stdout.trim()}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error("gh issue list returned non-JSON output");
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .filter((i) => typeof i.number === "number" && typeof i.title === "string")
    .map((i) => ({
      number: i.number as number,
      title: i.title as string,
      body: typeof i.body === "string" ? i.body : "",
      url: typeof i.url === "string" ? i.url : "",
    }));
}

export function issueGoal(repo: string, issue: GithubIssue): string {
  const body = issue.body.length > 4000 ? issue.body.slice(0, 4000) + "\n[truncated]" : issue.body;
  return [
    `Work on GitHub issue #${issue.number} of ${repo}: ${issue.title}`,
    issue.url ? `Issue URL: ${issue.url}` : "",
    "",
    body || "(no issue body)",
    "",
    "When the work is complete, summarize what you changed and reference the issue number.",
  ].join("\n");
}

export function issueSessionTitle(issue: GithubIssue): string {
  const slug = issue.title.length > 40 ? issue.title.slice(0, 40) + "…" : issue.title;
  return `issue-${issue.number}: ${slug}`;
}

export async function spawnFromIssues(
  host: Pick<HostClient, "sessionsCreate">,
  settings: PluginSettings,
  ownedSessionIds: Set<string>,
  listIssues: (repo: string, label: string, limit: number) => Promise<GithubIssue[]> = listOpenIssues
): Promise<SpawnReport> {
  const repo = settings.spawnRepo.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { repo, live: settings.spawnLive, outcomes: [], error: repo ? `spawn_repo "${repo}" is not owner/repo` : "spawn_repo is not configured" };
  }
  if (!settings.spawnAgent) {
    return { repo, live: settings.spawnLive, outcomes: [], error: "spawn_agent is not configured" };
  }

  let issues: GithubIssue[];
  try {
    issues = await listIssues(repo, settings.spawnLabel.trim(), settings.spawnLimit);
  } catch (err) {
    return { repo, live: settings.spawnLive, outcomes: [], error: err instanceof Error ? err.message : String(err) };
  }

  const outcomes: SpawnOutcome[] = [];
  let capacity = Math.max(0, settings.maxActiveSessions - ownedSessionIds.size);

  for (const issue of issues) {
    if (capacity <= 0) {
      outcomes.push({ issue, planned: false, created: false, skippedReason: `session pool full (max_active_sessions=${settings.maxActiveSessions})` });
      continue;
    }
    if (!settings.spawnLive) {
      outcomes.push({ issue, planned: true, created: false });
      capacity--;
      continue;
    }
    try {
      const res = await host.sessionsCreate({
        agent_id: settings.spawnAgent,
        project_path: settings.spawnProjectPath || undefined,
        model_id: settings.spawnModel || undefined,
        title: issueSessionTitle(issue),
        initial_turn: { text: issueGoal(repo, issue) },
        idempotency_key: `issue:${repo}#${issue.number}`,
      });
      if (res.session_id) ownedSessionIds.add(res.session_id);
      if (res.created) capacity--;
      outcomes.push({ issue, planned: false, created: res.created, sessionId: res.session_id, skippedReason: res.created ? undefined : "already spawned for this issue" });
    } catch (err) {
      // surface and continue: one refused create (rate limit, trust, mode)
      // should not abandon the rest of the run
      outcomes.push({ issue, planned: false, created: false, skippedReason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { repo, live: settings.spawnLive, outcomes };
}
