"use strict";

const crypto = require("node:crypto");
const { readAnswerToken } = require("./lib/token");

module.exports = async function checkAnswer(req, res) {
  const requestId = crypto.randomUUID();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed", requestId });
  }

  if (!process.env.QUIZ_SIGNING_SECRET) {
    console.error(`[${requestId}] QUIZ_SIGNING_SECRET is missing`);
    return res.status(500).json({ error: "サーバー設定が完了していません", requestId });
  }

  try {
    const body = parseBody(req.body);
    const selectedIndex = Number(body.selectedIndex);

    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) {
      return res.status(400).json({ error: "回答が正しくありません", requestId });
    }

    const payload = readAnswerToken(body.answerToken, process.env.QUIZ_SIGNING_SECRET);

    if (
      !Number.isInteger(payload.answerIndex) ||
      payload.answerIndex < 0 ||
      payload.answerIndex > 3 ||
      !Number.isFinite(payload.expiresAt)
    ) {
      throw new Error("Invalid token payload");
    }

    if (Date.now() > payload.expiresAt) {
      return res.status(410).json({
        error: "この問題の回答期限が切れました。次の問題を取得してください",
        requestId
      });
    }

    return res.status(200).json({
      correct: selectedIndex === payload.answerIndex,
      correctIndex: payload.answerIndex,
      explanation: typeof payload.explanation === "string" ? payload.explanation : "",
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      requestId
    });
  } catch (error) {
    console.error(`[${requestId}] Answer verification failed`, error);
    return res.status(400).json({
      error: "回答情報を確認できませんでした。問題を再読み込みしてください",
      requestId
    });
  }
};

function parseBody(body) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (typeof body !== "string" || body.length > 20_000) {
    throw new Error("Invalid request body");
  }
  return JSON.parse(body);
}
