// wakeable sleep — replaces dumb sleep() with a fs.watch-based primitive
// that wakes immediately when files appear in the watch directory.
// this drops message latency from up to 10s (full poll interval) to ~100ms.
import { watch, type FSWatcher } from "node:fs";

export type WakeReason = "timeout" | "wake" | "abort";

export interface WakeResult {
  reason: WakeReason;
  elapsed: number;
}

// minimum interval between wake events — prevents storm from daemon-state.json writes
const MIN_WAKE_INTERVAL_MS = 2000;

// files that should trigger a wake (user input, interrupt flag)
// daemon-state.json and supervisor-history.jsonl are excluded to prevent wake storms
const WAKE_FILES = new Set([
  "pending-input.txt",
  "interrupt",
]);

/**
 * Sleep for up to `ms` milliseconds, but wake early if:
 * - a relevant file change is detected in `watchDir` (returns "wake")
 * - the AbortSignal fires (returns "abort")
 * - the timeout expires naturally (returns "timeout")
 *
 * Uses fs.watch on the directory — fires when pending-input.txt is written
 * or the interrupt flag file is created. Ignores daemon-state.json and other
 * internal files to prevent wake storms.
 */
export function wakeableSleep(
  ms: number,
  watchDir: string,
  signal?: AbortSignal,
  minWakeIntervalMs: number = MIN_WAKE_INTERVAL_MS
): Promise<WakeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    let lastWakeAt = 0;

    const settle = (reason: WakeReason) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ reason, elapsed: Date.now() - start });
    };

    // timeout
    const timer = setTimeout(() => settle("timeout"), ms);

    // fs.watch on directory — fires on any file create/rename/change
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(watchDir, { persistent: false }, (_event, filename) => {
        // only wake for relevant files (user input, interrupt) — not internal state files
        if (filename && !WAKE_FILES.has(filename)) return;

        // debounce: don't wake more than once per minWakeIntervalMs
        const now = Date.now();
        if (now - lastWakeAt < minWakeIntervalMs) return;
        lastWakeAt = now;

        settle("wake");
      });
      // fs.watch can emit 'error' on broken watchers (e.g. dir deleted)
      watcher.on("error", () => {
        // silently degrade to timeout-only behavior
        if (watcher) { try { watcher.close(); } catch {} }
        watcher = null;
      });
    } catch {
      // if watch fails (e.g. dir doesn't exist yet), fall back to pure timeout
      watcher = null;
    }

    // abort signal
    const onAbort = () => settle("abort");
    signal?.addEventListener("abort", onAbort, { once: true });

    // also check if already aborted
    if (signal?.aborted) {
      settle("abort");
      return;
    }

    function cleanup() {
      clearTimeout(timer);
      if (watcher) { try { watcher.close(); } catch {} }
      signal?.removeEventListener("abort", onAbort);
    }
  });
}
