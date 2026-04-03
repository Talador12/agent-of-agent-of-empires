// session-output-annotations.ts — programmatic annotation of output lines
// with metadata. operators or modules can tag specific output lines with
// labels, severity, and notes for later analysis and filtering.

export interface OutputAnnotation {
  id: number;
  sessionTitle: string;
  lineIndex: number;     // which line in the output buffer
  lineText: string;      // the actual text of the line
  label: string;         // annotation label (e.g. "error", "milestone", "note")
  severity: "info" | "warning" | "error" | "critical";
  note?: string;
  createdAt: number;
  createdBy: string;     // module or operator that created it
}

export interface AnnotationState {
  annotations: OutputAnnotation[];
  nextId: number;
  maxAnnotations: number;
}

/**
 * Create annotation state.
 */
export function createAnnotationState(maxAnnotations = 500): AnnotationState {
  return { annotations: [], nextId: 1, maxAnnotations };
}

/**
 * Add an annotation to an output line.
 */
export function annotate(
  state: AnnotationState,
  sessionTitle: string,
  lineIndex: number,
  lineText: string,
  label: string,
  severity: OutputAnnotation["severity"],
  createdBy: string,
  note?: string,
  now = Date.now(),
): OutputAnnotation {
  const ann: OutputAnnotation = {
    id: state.nextId++,
    sessionTitle,
    lineIndex,
    lineText: lineText.slice(0, 200),
    label: label.slice(0, 30),
    severity,
    note: note?.slice(0, 200),
    createdAt: now,
    createdBy,
  };
  state.annotations.push(ann);
  if (state.annotations.length > state.maxAnnotations) {
    state.annotations = state.annotations.slice(-state.maxAnnotations);
  }
  return ann;
}

/**
 * Remove an annotation by ID.
 */
export function removeAnnotation(state: AnnotationState, id: number): boolean {
  const idx = state.annotations.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  state.annotations.splice(idx, 1);
  return true;
}

/**
 * Get annotations for a session.
 */
export function getSessionAnnotations(state: AnnotationState, sessionTitle: string): OutputAnnotation[] {
  return state.annotations.filter((a) => a.sessionTitle.toLowerCase() === sessionTitle.toLowerCase());
}

/**
 * Get annotations by severity.
 */
export function getAnnotationsBySeverity(state: AnnotationState, severity: OutputAnnotation["severity"]): OutputAnnotation[] {
  return state.annotations.filter((a) => a.severity === severity);
}

/**
 * Get annotations by label.
 */
export function getAnnotationsByLabel(state: AnnotationState, label: string): OutputAnnotation[] {
  return state.annotations.filter((a) => a.label.toLowerCase() === label.toLowerCase());
}

/**
 * Get annotation counts by severity.
 */
export function annotationCounts(state: AnnotationState): Record<string, number> {
  const counts: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const a of state.annotations) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  return counts;
}

/**
 * Format annotations for TUI display.
 */
export function formatAnnotations(annotations: OutputAnnotation[]): string[] {
  if (annotations.length === 0) return ["  Annotations: none"];
  const lines: string[] = [];
  lines.push(`  Output Annotations (${annotations.length}):`);
  const icons: Record<string, string> = { info: "ℹ", warning: "⚠", error: "✗", critical: "🔴" };
  for (const a of annotations.slice(-15)) {
    const icon = icons[a.severity] ?? "·";
    const time = new Date(a.createdAt).toISOString().slice(11, 19);
    const stripped = a.lineText.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 50);
    lines.push(`    ${icon} #${a.id} [${a.sessionTitle}] ${a.label} (${time}, ${a.createdBy})`);
    lines.push(`      "${stripped}"${a.note ? " — " + a.note : ""}`);
  }
  return lines;
}
