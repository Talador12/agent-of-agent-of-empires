// service-generator.ts — generate systemd/launchd service files for daemon
// auto-start on boot and crash restart. supports both Linux (systemd) and
// macOS (launchd) platforms.

import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface ServiceConfig {
  name: string;           // service name (default: "aoaoe")
  description: string;
  execPath: string;       // path to the aoaoe binary
  workingDir: string;     // working directory for the daemon
  configPath?: string;    // path to aoaoe.config.json
  user?: string;          // run as this user (systemd only)
  restartSec: number;     // restart delay in seconds (default: 5)
  logPath?: string;       // log file path
}

const DEFAULT_CONFIG: ServiceConfig = {
  name: "aoaoe",
  description: "aoaoe — autonomous supervisor daemon for agent-of-empires",
  execPath: "aoaoe",
  workingDir: process.cwd(),
  restartSec: 5,
};

/**
 * Generate a systemd unit file for Linux.
 */
export function generateSystemdUnit(config: Partial<ServiceConfig> = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config };
  const execStart = c.configPath
    ? `${c.execPath} --config ${c.configPath}`
    : c.execPath;

  return `[Unit]
Description=${c.description}
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${c.workingDir}
Restart=on-failure
RestartSec=${c.restartSec}
${c.user ? `User=${c.user}` : ""}
${c.logPath ? `StandardOutput=append:${c.logPath}\nStandardError=append:${c.logPath}` : "StandardOutput=journal\nStandardError=journal"}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Generate a launchd plist file for macOS.
 */
export function generateLaunchdPlist(config: Partial<ServiceConfig> = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config };
  const logPath = c.logPath ?? join(homedir(), "Library", "Logs", "aoaoe.log");
  const errPath = c.logPath ? c.logPath.replace(".log", ".err.log") : join(homedir(), "Library", "Logs", "aoaoe.err.log");
  const args = c.configPath
    ? [`${c.execPath}`, "--config", c.configPath]
    : [c.execPath];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aoaoe.daemon</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escXml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escXml(c.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>${c.restartSec}</integer>
  <key>StandardOutPath</key>
  <string>${escXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escXml(errPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

/**
 * Detect the current platform and generate the appropriate service file.
 */
export function generateServiceFile(config: Partial<ServiceConfig> = {}): { content: string; filename: string; installPath: string; platform: string } {
  const os = platform();
  if (os === "darwin") {
    const filename = "com.aoaoe.daemon.plist";
    const installPath = join(homedir(), "Library", "LaunchAgents", filename);
    return { content: generateLaunchdPlist(config), filename, installPath, platform: "launchd" };
  }
  // Linux + fallback
  const filename = `${config.name ?? "aoaoe"}.service`;
  const installPath = join("/etc", "systemd", "system", filename);
  return { content: generateSystemdUnit(config), filename, installPath, platform: "systemd" };
}

/**
 * Write the service file and return install instructions.
 */
export function installService(config: Partial<ServiceConfig> = {}): string[] {
  const { content, filename, installPath, platform: plat } = generateServiceFile(config);
  const outDir = join(homedir(), ".aoaoe");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, filename);
  writeFileSync(outPath, content);

  const lines: string[] = [];
  lines.push(`Generated ${plat} service file: ${outPath}`);
  lines.push("");
  if (plat === "systemd") {
    lines.push("Install with:");
    lines.push(`  sudo cp ${outPath} ${installPath}`);
    lines.push("  sudo systemctl daemon-reload");
    lines.push(`  sudo systemctl enable ${filename}`);
    lines.push(`  sudo systemctl start ${filename.replace(".service", "")}`);
  } else {
    lines.push("Install with:");
    lines.push(`  cp ${outPath} ${installPath}`);
    lines.push(`  launchctl load ${installPath}`);
    lines.push("");
    lines.push("Uninstall with:");
    lines.push(`  launchctl unload ${installPath}`);
    lines.push(`  rm ${installPath}`);
  }
  return lines;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
