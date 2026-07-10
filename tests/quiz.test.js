"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPrompt,
  extractInteractionText,
  normalizeCharacter,
  normalizeExcludedQuestions,
  normalizeMode,
  validateQuiz
} = require("../api/lib/quiz");

test("normalizers fall back to safe defaults", () => {
  assert.equal(normalizeMode("hard"), "hard");
  assert.equal(normalizeMode("invalid"), "easy");
  assert.equal(normalizeCharacter("miko"), "miko");
  assert.equal(normalizeCharacter("invalid"), "pekora");
});

test("excluded questions are trimmed and limited to the latest 20", () => {
  const value = normalizeExcludedQuestions([
    "  q01  ",
    123,
    "q02",
    "q03",
    "q04",
    "q05",
    "q06",
    "q07",
    "q08",
    "q09",
    "q10",
    "q11",
    "q12",
    "q13",
    "q14",
    "q15",
    "q16",
    "q17",
    "q18",
    "q19",
    "q20",
    "q21"
  ]);

  assert.deepEqual(
    value,
    Array.from({ length: 20 }, (_, index) =>
      `q${String(index + 2).padStart(2, "0")}`
    )
  );
});

test("valid quiz is normalized and answer index is calculated", () => {
  const result = validateQuiz({
    question: "  誕生日はいつ？  ",
    choices: ["1月1日", "1月2日", "1月3日", "1月4日"],
    answer: "1月2日",
    explanation: "  公式プロフィールに記載されています。  "
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.question, "誕生日はいつ？");
  assert.equal(result.data.answerIndex, 1);
  assert.equal(result.data.explanation, "公式プロフィールに記載されています。");
});

test("duplicate choices are rejected", () => {
  const result = validateQuiz({
    question: "問題",
    choices: ["A", "A", "B", "C"],
    answer: "A",
    explanation: "説明"
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /重複/);
});

test("interaction text is extracted from model output steps", () => {
  const text = extractInteractionText({
    steps: [
      { type: "thought" },
      {
        type: "model_output",
        content: [
          { type: "text", text: "{\"question\":" },
          { type: "text", text: "\"Q\"}" }
        ]
      }
    ]
  });

  assert.equal(text, '{"question":"Q"}');
});

test("prompt contains selected character and source restriction", () => {
  const prompt = buildPrompt({
    mode: "easy",
    character: "pekora",
    excludedQuestions: ["過去の問題"]
  });

  assert.match(prompt, /兎田ぺこら/);
  assert.match(prompt, /URL Context/);
  assert.match(prompt, /過去の問題/);
});
