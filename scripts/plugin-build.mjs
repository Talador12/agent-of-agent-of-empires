#!/usr/bin/env node
// Install-time build for the AoE plugin runtime (see aoe-plugin.toml).
//
// Everything must land under .aoe-build/ — it is the only directory AoE
// excludes from the plugin integrity tree hash, so a node_modules/ or dist/
// anywhere else would break hash verification on the next daemon load.
// The package has zero runtime dependencies; only typescript + @types/node
// are needed, and only at build time, so they are installed into an isolated
// .aoe-build/deps prefix and discarded from the runtime path.

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deps = join(root, ".aoe-build", "deps");

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
  }
}

mkdirSync(deps, { recursive: true });
copyFileSync(join(root, "package.json"), join(deps, "package.json"));
copyFileSync(join(root, "package-lock.json"), join(deps, "package-lock.json"));
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], deps);

const tsc = join(deps, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) throw new Error(`typescript not found at ${tsc}`);
run("node", [tsc, "-p", join(root, "tsconfig.plugin.json")], root);

// Compiled output sits outside the package root's module scope safety: pin
// ESM resolution explicitly so a future package.json in .aoe-build can't
// flip the module type under the worker.
writeFileSync(join(root, ".aoe-build", "dist", "package.json"), '{"type":"module"}\n');
console.log("plugin build complete: .aoe-build/dist/plugin/worker.js");
