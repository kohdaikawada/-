"use strict";

const MODES = new Set(["easy", "medium", "hard"]);
const CHARACTERS = new Set(["pekora", "miko"]);

const CHARACTER_CONFIG = Object.freeze({
  pekora: {
    displayName: "兎田ぺこら",
    officialUrl: "https://hololive.hololivepro.com/talents/usada-pekora/",
    wikiUrl: "https://seesaawiki.jp/hololivetv/d/兎田ぺこら"
  },
  miko: {
    displayName: "さくらみこ",
    officialUrl: "https://hololive.hololivepro.com/talents/sakuramiko/",
    wikiUrl: "https://seesaawiki.jp/hololivetv/d/さくらみこ"
  }
});

const MODE_TEXT = Object.freeze({
  easy: "初心者向け。公式プロフィールで確認できる基本情報を中心にする。",
  medium: "中級者向け。基本情報に加え、定番の用語や活動に関する知識を扱う。",
  hard: "上級者向け。参照ページに明記された細かな情報を扱う。ただし曖昧な出来事や時期で変わる情報は避ける。"
});

const QUIZ_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["question", "choices", "answer", "explanation"],
  properties: {
    question: {
      type: "string",
      description: "日本語の4択クイズ問題文。160文字以内。"
    },
    choices: {
      type: "array",
      description: "重複のない4つの選択肢。各60文字以内。",
      minItems: 4,
      maxItems: 4,
      items: { type: "string" }
    },
    answer: {
      type: "string",
      description: "choicesの中の正解と完全一致する文字列。"
    },
    explanation: {
      type: "string",
      description: "正解の根拠を簡潔に説明する日本語。240文字以内。"
    }
  }
});

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : "easy";
}

function normalizeCharacter(character) {
  return CHARACTERS.has(character) ? character : "pekora";
}

function normalizeExcludedQuestions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, 180))
    .filter(Boolean)
    .slice(-20);
}

function getSources(mode, character) {
  const config = CHARACTER_CONFIG[character];
  const sources = [
    { title: "hololive公式プロフィール", url: config.officialUrl }
  ];

  if (mode !== "easy") {
    sources.push({ title: "ホロライブ非公式wiki", url: config.wikiUrl });
  }

  return sources;
}

function buildPrompt({ mode, character, excludedQuestions = [] }) {
  const config = CHARACTER_CONFIG[character];
  const sources = getSources(mode, character);
  const sourceLines = sources.map((source) => `- ${source.url}`).join("\n");
  const exclusionText = excludedQuestions.length
    ? `\n直近に出題済みの問題（同じ内容を避ける）:\n${excludedQuestions
        .map((question) => `- ${question}`)
        .join("\n")}`
    : "";

  return `対象キャラクター「${config.displayName}」について、日本語の4択クイズを1問作成してください。

難易度:
${MODE_TEXT[mode]}

参照を許可するURL:
${sourceLines}

必須条件:
- URL Contextを使い、上記URLに明記された内容だけを根拠にする
- モデル自身の記憶や、上記以外のサイトの情報は使わない
- 現在の登録者数、直近の配信予定、最新ニュースなど変化しやすい情報は扱わない
- 問題文だけで正解が一意に決まるようにする
- 選択肢は4つ、重複なし
- 正解はchoicesの1項目と完全一致させる
- 不正解の選択肢も同じ種類・粒度にそろえる
- explanationには、参照ページに基づく正解の根拠を簡潔に書く
- ファンを侮辱する表現、過度に内輪的な表現、センシティブな話題は避ける
${exclusionText}`.trim();
}

function validateQuiz(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "JSON objectではありません" };
  }

  const question = cleanString(value.question);
  const choices = Array.isArray(value.choices)
    ? value.choices.map(cleanString)
    : [];
  const answer = cleanString(value.answer);
  const explanation = cleanString(value.explanation);

  if (!question || question.length > 160) {
    return { ok: false, reason: "questionが不正です" };
  }

  if (choices.length !== 4 || choices.some((choice) => !choice || choice.length > 60)) {
    return { ok: false, reason: "choicesは60文字以内の4件である必要があります" };
  }

  if (new Set(choices).size !== 4) {
    return { ok: false, reason: "choicesに重複があります" };
  }

  const answerIndex = choices.indexOf(answer);
  if (answerIndex === -1) {
    return { ok: false, reason: "answerがchoicesと一致しません" };
  }

  if (!explanation || explanation.length > 240) {
    return { ok: false, reason: "explanationが不正です" };
  }

  return {
    ok: true,
    data: { question, choices, answerIndex, explanation }
  };
}

function extractInteractionText(data) {
  if (!Array.isArray(data?.steps)) return "";

  return data.steps
    .filter((step) => step?.type === "model_output" && Array.isArray(step.content))
    .flatMap((step) => step.content)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function extractCitedSources(data, allowedSources) {
  if (!Array.isArray(data?.steps)) return [];

  const allowedHosts = new Set(
    allowedSources.map((source) => new URL(source.url).hostname)
  );
  const found = new Map();

  for (const step of data.steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;

    for (const block of step.content) {
      if (!Array.isArray(block?.annotations)) continue;

      for (const annotation of block.annotations) {
        if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") {
          continue;
        }

        try {
          const url = new URL(annotation.url);
          if (!allowedHosts.has(url.hostname)) continue;

          found.set(url.href, {
            title: cleanString(annotation.title) || url.hostname,
            url: url.href
          });
        } catch (_) {
          // Ignore malformed citation URLs from the model response.
        }
      }
    }
  }

  return [...found.values()];
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  CHARACTER_CONFIG,
  QUIZ_SCHEMA,
  buildPrompt,
  extractCitedSources,
  extractInteractionText,
  getSources,
  normalizeCharacter,
  normalizeExcludedQuestions,
  normalizeMode,
  validateQuiz
};
