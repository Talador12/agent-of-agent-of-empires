import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ObservationCache } from "./observation-cache.js";

describe("ObservationCache", () => {
  it("returns null on cache miss", () => {
    const cache = new ObservationCache();
    assert.equal(cache.get('{"sessions":[]}'), null);
  });

  it("returns cached result on hit", () => {
    const cache = new ObservationCache();
    const result = { actions: [], reasoning: "wait" };
    cache.set('{"sessions":[]}', result);
    const hit = cache.get('{"sessions":[]}');
    assert.deepEqual(hit, result);
  });

  it("strips timestamps for cache key", () => {
    const cache = new ObservationCache();
    const result = { actions: [], reasoning: "wait" };
    cache.set('{"capturedAt":1000,"data":"x"}', result);
    const hit = cache.get('{"capturedAt":9999,"data":"x"}');
    assert.deepEqual(hit, result); // same content, different timestamp → hit
  });

  it("expires entries after TTL", () => {
    const cache = new ObservationCache(1000); // 1s TTL
    const now = Date.now();
    cache.set('{"data":"x"}', { actions: [] }, now);
    assert.ok(cache.get('{"data":"x"}', now)); // immediate hit
    assert.equal(cache.get('{"data":"x"}', now + 2000), null); // expired
  });

  it("evicts oldest when max entries exceeded", () => {
    const cache = new ObservationCache(60_000, 3); // max 3
    cache.set('{"a":1}', { actions: [] });
    cache.set('{"b":2}', { actions: [] });
    cache.set('{"c":3}', { actions: [] });
    cache.set('{"d":4}', { actions: [] }); // should evict "a"
    assert.equal(cache.get('{"a":1}'), null);
    assert.ok(cache.get('{"d":4}'));
  });

  it("tracks hit/miss stats", () => {
    const cache = new ObservationCache();
    cache.set('{"x":1}', { actions: [] });
    cache.get('{"x":1}'); // hit
    cache.get('{"y":2}'); // miss
    const stats = cache.getStats();
    assert.equal(stats.totalHits, 1);
    assert.equal(stats.totalMisses, 1);
    assert.equal(stats.hitRate, 0.5);
  });

  it("formatStats handles empty cache", () => {
    const cache = new ObservationCache();
    const lines = cache.formatStats();
    assert.ok(lines[0].includes("no cache activity"));
  });

  it("clear removes all entries", () => {
    const cache = new ObservationCache();
    cache.set('{"x":1}', { actions: [] });
    cache.clear();
    assert.equal(cache.get('{"x":1}'), null);
  });

  it("hashObservation produces consistent hashes", () => {
    const h1 = ObservationCache.hashObservation('{"data":"test","capturedAt":1}');
    const h2 = ObservationCache.hashObservation('{"data":"test","capturedAt":2}');
    assert.equal(h1, h2); // timestamps stripped
  });
});
