import { describe, expect, it } from "vitest";
import { canonicalJson, generateApiKey, hashPassword, parseApiKey, randomToken, sha256, signPayload, verifyPassword, verifySignature } from "./crypto.js";
import { cleanAnswers, MISSION_HAPPINESS } from "./survey.js";

describe("crypto", () => {
  it("makes url-safe tokens of the requested length", () => {
    const t = randomToken(22);
    expect(t).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(randomToken(22)).not.toBe(t);
  });

  it("round-trips api keys", () => {
    const k = generateApiKey();
    const p = parseApiKey(k.key)!;
    expect(p.prefix).toBe(k.prefix);
    expect(sha256(p.secret)).toBe(k.secretHash);
    expect(parseApiKey("lk_live_bad")).toBeNull();
  });

  it("signs and verifies payloads, rejecting tampering and stale timestamps", () => {
    const sig = signPayload("s3cret", '{"a":1}');
    expect(verifySignature("s3cret", '{"a":1}', sig)).toBe(true);
    expect(verifySignature("s3cret", '{"a":2}', sig)).toBe(false);
    expect(verifySignature("s3cret", '{"a":1}', signPayload("s3cret", '{"a":1}', 1000))).toBe(false);
  });

  it("hashes passwords", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("canonical json ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("survey", () => {
  it("keeps branching answers that are visible and drops hidden ones", () => {
    const low = cleanAnswers(MISSION_HAPPINESS, { overall: 2, improve: ["Waiting time", "Hacked"], loved: ["Pricing"], nps: 4 });
    expect(low.errors).toEqual([]);
    expect(low.answers).toEqual({ overall: 2, improve: ["Waiting time"], nps: 4 });
  });

  it("requires the primary rating and validates ranges", () => {
    expect(cleanAnswers(MISSION_HAPPINESS, {}).errors).toContain("overall is required");
    expect(cleanAnswers(MISSION_HAPPINESS, { overall: 9 }).errors[0]).toMatch(/1–5/);
  });
});
