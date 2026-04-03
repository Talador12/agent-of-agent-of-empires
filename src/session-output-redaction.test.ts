import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { OutputRedactor, formatRedactionStats } from "./session-output-redaction.js";

describe("OutputRedactor", () => {
  it("starts with default rules and zero stats", () => {
    const r = new OutputRedactor();
    assert.ok(r.getRuleCount() > 5);
    assert.equal(r.getStats().totalCalls, 0);
  });

  it("redacts bearer tokens", () => {
    const r = new OutputRedactor();
    const result = r.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig");
    assert.ok(result.redacted.includes("[REDACTED]"));
    assert.ok(!result.redacted.includes("eyJ"));
    assert.ok(result.matchCount > 0);
  });

  it("redacts API keys", () => {
    const r = new OutputRedactor();
    const result = r.redact('api_key="sk-1234567890abcdef1234567890abcdef"');
    assert.ok(result.redacted.includes("[API_KEY_REDACTED]"));
  });

  it("redacts AWS access keys", () => {
    const r = new OutputRedactor();
    const result = r.redact("AKIAIOSFODNN7EXAMPLE");
    assert.ok(result.redacted.includes("[AWS_KEY_REDACTED]"));
  });

  it("redacts JWTs", () => {
    const r = new OutputRedactor();
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = r.redact(`token: ${jwt}`);
    assert.ok(result.redacted.includes("[JWT_REDACTED]"));
  });

  it("redacts private keys", () => {
    const r = new OutputRedactor();
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJ...\n-----END RSA PRIVATE KEY-----";
    const result = r.redact(key);
    assert.ok(result.redacted.includes("[PRIVATE_KEY_REDACTED]"));
  });

  it("redacts passwords", () => {
    const r = new OutputRedactor();
    const result = r.redact('password=SuperSecret123!');
    assert.ok(result.redacted.includes("[PASSWORD_REDACTED]"));
  });

  it("redacts connection strings", () => {
    const r = new OutputRedactor();
    const result = r.redact("mongodb://user:pass@host:27017/db");
    assert.ok(result.redacted.includes("[CONNECTION_STRING_REDACTED]"));
  });

  it("redacts email addresses", () => {
    const r = new OutputRedactor();
    const result = r.redact("contact user@example.com for help");
    assert.ok(result.redacted.includes("[EMAIL_REDACTED]"));
  });

  it("redacts IPv4 addresses", () => {
    const r = new OutputRedactor();
    const result = r.redact("connecting to 192.168.1.100:8080");
    assert.ok(result.redacted.includes("[IP_REDACTED]"));
  });

  it("leaves clean text unchanged", () => {
    const r = new OutputRedactor();
    const clean = "All 42 tests passed. Build succeeded.";
    const result = r.redact(clean);
    assert.equal(result.redacted, clean);
    assert.equal(result.matchCount, 0);
  });

  it("tracks stats across multiple calls", () => {
    const r = new OutputRedactor();
    r.redact("Bearer abc123def456ghi789jkl012mno345");
    r.redact("password=hunter2hunter2");
    const stats = r.getStats();
    assert.equal(stats.totalCalls, 2);
    assert.ok(stats.totalRedactions >= 2);
  });

  it("supports custom rules", () => {
    const r = new OutputRedactor([
      { name: "custom", pattern: /SECRET_\w+/g, replacement: "[CUSTOM_REDACTED]" },
    ]);
    const result = r.redact("found SECRET_ABC123");
    assert.ok(result.redacted.includes("[CUSTOM_REDACTED]"));
    assert.equal(r.getRuleCount(), 1);
  });

  it("addRule extends the rule set", () => {
    const r = new OutputRedactor();
    const before = r.getRuleCount();
    r.addRule({ name: "extra", pattern: /XTRA_\w+/g, replacement: "[EXTRA]" });
    assert.equal(r.getRuleCount(), before + 1);
  });
});

describe("formatRedactionStats", () => {
  it("shows no-secrets message initially", () => {
    const r = new OutputRedactor();
    const lines = formatRedactionStats(r);
    assert.ok(lines.some((l) => l.includes("No secrets")));
  });

  it("shows rule hit counts after redactions", () => {
    const r = new OutputRedactor();
    r.redact("Bearer longTokenValueHere1234567890ab");
    const lines = formatRedactionStats(r);
    assert.ok(lines.some((l) => l.includes("bearer-token") || l.includes("match")));
  });
});
