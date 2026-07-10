"use strict";

const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function createAnswerToken(payload, secret) {
  assertSecret(secret);

  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map(toBase64Url).join(".");
}

function readAnswerToken(token, secret) {
  assertSecret(secret);

  if (typeof token !== "string") {
    throw new Error("Invalid token");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token");
  }

  const [ivPart, tagPart, encryptedPart] = parts;
  const iv = fromBase64Url(ivPart);
  const tag = fromBase64Url(tagPart);
  const encrypted = fromBase64Url(encryptedPart);

  if (iv.length !== IV_LENGTH || tag.length !== 16 || encrypted.length === 0) {
    throw new Error("Invalid token");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8");

  const payload = JSON.parse(decrypted);
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid token payload");
  }

  return payload;
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function assertSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("QUIZ_SIGNING_SECRET must be at least 32 characters");
  }
}

function toBase64Url(buffer) {
  return buffer.toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url");
}

module.exports = { createAnswerToken, readAnswerToken };
