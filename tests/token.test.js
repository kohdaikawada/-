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
  const parts = token.split(".");

  // 認証タグをバイト単位で確実に改変する。
  // Base64URL文字列の末尾だけを変える方法では、未使用ビットの影響で
  // 別の文字列が同じバイト列へ復号され、テストが不安定になる場合がある。
  const tag = Buffer.from(parts[1], "base64url");
  tag[0] ^= 0x01;
  parts[1] = tag.toString("base64url");

  const tampered = parts.join(".");

  assert.throws(() => readAnswerToken(tampered, secret));
});
