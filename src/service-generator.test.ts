import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateSystemdUnit, generateLaunchdPlist, generateServiceFile } from "./service-generator.js";

describe("generateSystemdUnit", () => {
  it("generates valid systemd unit file", () => {
    const unit = generateSystemdUnit({ workingDir: "/opt/aoaoe" });
    assert.ok(unit.includes("[Unit]"));
    assert.ok(unit.includes("[Service]"));
    assert.ok(unit.includes("[Install]"));
    assert.ok(unit.includes("ExecStart=aoaoe"));
    assert.ok(unit.includes("/opt/aoaoe"));
    assert.ok(unit.includes("Restart=on-failure"));
  });

  it("includes user when specified", () => {
    const unit = generateSystemdUnit({ user: "deploy" });
    assert.ok(unit.includes("User=deploy"));
  });

  it("includes config path when specified", () => {
    const unit = generateSystemdUnit({ configPath: "/etc/aoaoe/config.json" });
    assert.ok(unit.includes("--config /etc/aoaoe/config.json"));
  });

  it("uses custom restart interval", () => {
    const unit = generateSystemdUnit({ restartSec: 10 });
    assert.ok(unit.includes("RestartSec=10"));
  });
});

describe("generateLaunchdPlist", () => {
  it("generates valid plist XML", () => {
    const plist = generateLaunchdPlist({ workingDir: "/Users/dev/repos" });
    assert.ok(plist.includes("<?xml"));
    assert.ok(plist.includes("com.aoaoe.daemon"));
    assert.ok(plist.includes("RunAtLoad"));
    assert.ok(plist.includes("KeepAlive"));
    assert.ok(plist.includes("/Users/dev/repos"));
  });

  it("includes config path in arguments", () => {
    const plist = generateLaunchdPlist({ configPath: "/etc/aoaoe.json" });
    assert.ok(plist.includes("--config"));
    assert.ok(plist.includes("/etc/aoaoe.json"));
  });

  it("escapes XML special characters", () => {
    const plist = generateLaunchdPlist({ workingDir: "/path/with <special> & chars" });
    assert.ok(plist.includes("&lt;special&gt;"));
    assert.ok(plist.includes("&amp;"));
  });
});

describe("generateServiceFile", () => {
  it("returns platform-appropriate file", () => {
    const result = generateServiceFile();
    assert.ok(result.content.length > 0);
    assert.ok(result.filename.length > 0);
    assert.ok(result.installPath.length > 0);
    assert.ok(result.platform === "systemd" || result.platform === "launchd");
  });
});
