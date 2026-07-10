"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAnswerToken, readAnswerToken } = require("../api/lib/token");

const secret = "0123456789abcdef0123456789abcdef";

test("answer token round-trips encrypted payload", () => {
  const payload = {
    answerIndex: 2,
    explanation: "説明",
    expiresAt: Date.now() + 60_000
  };

  const token = createAnswerToken(payload, secret);
  const decoded = readAnswerToken(token, secret);

  assert.deepEqual(decoded, payload);
  assert.equal(token.includes("説明"), false);
});

test("tampered answer token is rejected", () => {
  const token = createAnswerToken({ answerIndex: 1 }, secret);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

  assert.throws(() => readAnswerToken(tampered, secret));
});
