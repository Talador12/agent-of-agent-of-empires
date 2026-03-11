// activity.ts — detect user interaction in tmux panes
// prevents the reasoner from interfering when a user is actively typing
//
// detection: `tmux list-clients -t <session> -F '#{client_activity}'`
// returns Unix epoch seconds of last keystroke per attached client.
// if any client was active within the threshold, the user is considered active.

import { exec } from "./shell.js";

const DEFAULT_THRESHOLD_MS = 30_000; // 30 seconds

export interface ActivityInfo {
  tmuxName: string;
  userActive: boolean;
  lastActivityMs: number; // ms since last user keystroke (Infinity if no clients)
  clientCount: number;
}

// check if a user is actively interacting with a tmux session
export async function getSessionActivity(
  tmuxName: string,
  thresholdMs = DEFAULT_THRESHOLD_MS
): Promise<ActivityInfo> {
  const noClients: ActivityInfo = {
    tmuxName,
    userActive: false,
    lastActivityMs: Infinity,
    clientCount: 0,
  };

  if (!tmuxName) return noClients;

  try {
    const result = await exec(
      "tmux",
      ["list-clients", "-t", tmuxName, "-F", "#{client_activity}"],
      5_000
    );

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return noClients;
    }

    const lines = result.stdout.trim().split("\n").filter((l) => l.trim());
    if (lines.length === 0) return noClients;

    const nowSec = Math.floor(Date.now() / 1000);
    let minAgeMs = Infinity;

    for (const line of lines) {
      const epoch = parseInt(line.trim(), 10);
      if (!isNaN(epoch) && epoch > 0) {
        const ageMs = Math.max(0, (nowSec - epoch) * 1000);
        if (ageMs < minAgeMs) minAgeMs = ageMs;
      }
    }

    return {
      tmuxName,
      userActive: minAgeMs < thresholdMs,
      lastActivityMs: minAgeMs,
      clientCount: lines.length,
    };
  } catch {
    return noClients;
  }
}

// batch check multiple sessions in parallel
export async function getActivityForSessions(
  tmuxNames: string[],
  thresholdMs = DEFAULT_THRESHOLD_MS
): Promise<Map<string, ActivityInfo>> {
  if (tmuxNames.length === 0) return new Map();

  const results = await Promise.allSettled(
    tmuxNames.map((name) => getSessionActivity(name, thresholdMs))
  );

  const map = new Map<string, ActivityInfo>();
  for (let i = 0; i < tmuxNames.length; i++) {
    const r = results[i];
    const name = tmuxNames[i];
    if (r.status === "fulfilled") {
      map.set(name, r.value);
    } else {
      map.set(name, {
        tmuxName: name,
        userActive: false,
        lastActivityMs: Infinity,
        clientCount: 0,
      });
    }
  }

  return map;
}
