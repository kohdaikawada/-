"use strict";

const crypto = require("node:crypto");
const {
  QUIZ_SCHEMA,
  buildPrompt,
  extractCitedSources,
  extractInteractionText,
  getSources,
  normalizeCharacter,
  normalizeExcludedQuestions,
  normalizeMode,
  validateQuiz
} = require("./lib/quiz");
const { createAnswerToken } = require("./lib/token");

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 12_000;
const ANSWER_TOKEN_TTL_MS = 10 * 60 * 1000;

module.exports = async function generateQuiz(req, res) {
  const requestId = crypto.randomUUID();
  setCommonHeaders(res, requestId);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed", requestId });
  }

  if (!process.env.GEMINI_API_KEY || !process.env.QUIZ_SIGNING_SECRET) {
    console.error(`[${requestId}] Required environment variables are missing`);
    return res.status(500).json({
      error: "サーバー設定が完了していません",
      requestId
    });
  }

  try {
    const body = parseBody(req.body);
    const mode = normalizeMode(body.mode);
    const character = normalizeCharacter(body.character);
    const excludedQuestions = normalizeExcludedQuestions(body.excludeQuestions);
    const sources = getSources(mode, character);
    const prompt = buildPrompt({ mode, character, excludedQuestions });

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const interaction = await callGemini({ prompt, schema: QUIZ_SCHEMA });
        const text = extractInteractionText(interaction);

        if (!text) {
          throw new Error("Gemini returned no text output");
        }

        const parsed = JSON.parse(text);
        const validated = validateQuiz(parsed);

        if (!validated.ok) {
          throw new Error(validated.reason);
        }

        if (
          isDuplicateQuestion(
            validated.data.question,
            excludedQuestions
          )
        ) {
          throw new Error("直近の問題と重複しています");
        }

        const citedSources = extractCitedSources(interaction, sources);
        const finalSources = citedSources.length ? citedSources : sources;
        const expiresAt = Date.now() + ANSWER_TOKEN_TTL_MS;
        const answerToken = createAnswerToken(
          {
            answerIndex: validated.data.answerIndex,
            explanation: validated.data.explanation,
            sources: finalSources,
            expiresAt
          },
          process.env.QUIZ_SIGNING_SECRET
        );

        return res.status(200).json({
          question: validated.data.question,
          choices: validated.data.choices,
          answerToken,
          expiresAt,
          requestId
        });
      } catch (error) {
        lastError = error;
        console.error(`[${requestId}] Attempt ${attempt} failed`, error);

        if (attempt < MAX_ATTEMPTS) {
          await sleep(250 * attempt);
        }
      }
    }

    console.error(`[${requestId}] Quiz generation failed`, lastError);
    return res.status(502).json({
      error: "クイズの生成に失敗しました。少し待ってから再試行してください",
      requestId
    });
  } catch (error) {
    console.error(`[${requestId}] Request failed`, error);
    return res.status(400).json({
      error: "リクエストの形式が正しくありません",
      requestId
    });
  }
};

async function callGemini({ prompt, schema }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Api-Revision": "2026-05-20"
      },
      body: JSON.stringify({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        input: prompt,
        system_instruction:
          "あなたは出典に忠実なクイズ編集者です。与えられたURLの内容を確認し、曖昧さのない問題だけを作成してください。",
        tools: [{ type: "url_context" }],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema
        },
        generation_config: {
          temperature: 0.9
        },
        store: false
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const apiMessage = data?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Gemini API error: ${apiMessage}`);
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Gemini API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(body) {
  if (body == null || body === "") return {};
  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (typeof body !== "string" || body.length > 10_000) {
    throw new Error("Invalid request body");
  }
  return JSON.parse(body);
}

function setCommonHeaders(res, requestId) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-Id", requestId);
}


function normalizeQuestion(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　、。,.!?！？「」『』（）()・:：]/g, "");
}

function createBigrams(text) {
  const result = new Set();

  for (let i = 0; i < text.length - 1; i += 1) {
    result.add(text.slice(i, i + 2));
  }

  return result;
}

function calculateSimilarity(a, b) {
  const setA = createBigrams(a);
  const setB = createBigrams(b);

  if (setA.size === 0 || setB.size === 0) {
    return a === b ? 1 : 0;
  }

  let intersection = 0;

  for (const item of setA) {
    if (setB.has(item)) {
      intersection += 1;
    }
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

function isDuplicateQuestion(question, excludedQuestions) {
  const normalizedQuestion = normalizeQuestion(question);

  return excludedQuestions.some((previousQuestion) => {
    const normalizedPrevious = normalizeQuestion(previousQuestion);

    return (
      normalizedQuestion === normalizedPrevious ||
      calculateSimilarity(
        normalizedQuestion,
        normalizedPrevious
      ) >= 0.72
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
