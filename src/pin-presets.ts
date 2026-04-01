// pin-presets.ts — save/restore named sets of pinned session titles.
// stored in ~/.aoaoe/pin-presets.json as { presetName: ["title1", "title2"] }.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BOLD, DIM, GREEN, YELLOW, RED, RESET } from "./colors.js";

const AOAOE_DIR = join(homedir(), ".aoaoe");
const PRESETS_FILE = join(AOAOE_DIR, "pin-presets.json");

export interface PinPresets {
  [name: string]: string[]; // preset name -> array of session titles
}

export function loadPinPresets(filePath = PRESETS_FILE): PinPresets {
  try {
    if (!existsSync(filePath)) return {};
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const result: PinPresets = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v) && v.every((s) => typeof s === "string")) {
        result[k] = v as string[];
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function savePinPresets(presets: PinPresets, filePath = PRESETS_FILE): void {
  try {
    if (!existsSync(AOAOE_DIR)) mkdirSync(AOAOE_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(presets, null, 2) + "\n");
  } catch (e) {
    console.error(`failed to save pin presets: ${e}`);
  }
}

export function savePreset(name: string, titles: string[], filePath = PRESETS_FILE): void {
  const presets = loadPinPresets(filePath);
  presets[name] = titles;
  savePinPresets(presets, filePath);
}

export function deletePreset(name: string, filePath = PRESETS_FILE): boolean {
  const presets = loadPinPresets(filePath);
  const lower = name.toLowerCase();
  const key = Object.keys(presets).find((k) => k.toLowerCase() === lower);
  if (!key) return false;
  delete presets[key];
  savePinPresets(presets, filePath);
  return true;
}

export function getPreset(name: string, filePath = PRESETS_FILE): string[] | undefined {
  const presets = loadPinPresets(filePath);
  const lower = name.toLowerCase();
  const key = Object.keys(presets).find((k) => k.toLowerCase() === lower);
  return key ? presets[key] : undefined;
}

export function formatPresetList(filePath = PRESETS_FILE): string {
  const presets = loadPinPresets(filePath);
  const names = Object.keys(presets);
  if (names.length === 0) return `  ${DIM}(no saved presets)${RESET}\n  ${DIM}save: /pin-save <name>${RESET}`;
  const lines: string[] = [];
  lines.push(`  ${BOLD}saved pin presets:${RESET}`);
  for (const name of names) {
    const titles = presets[name];
    lines.push(`  ${GREEN}${name}${RESET} — ${titles.join(", ")} ${DIM}(${titles.length} sessions)${RESET}`);
  }
  lines.push("");
  lines.push(`  ${DIM}restore: /pin-load <name>  |  delete: /pin-delete <name>${RESET}`);
  return lines.join("\n");
}
