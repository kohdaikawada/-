module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const mode = normalizeMode(body.mode);
    const character = normalizeCharacter(body.character);

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY が設定されていません" });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["question", "choices", "answer"],
      properties: {
        question: {
          type: "string",
          description: "4択クイズの問題文"
        },
        choices: {
          type: "array",
          description: "必ず4つの選択肢",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "string"
          }
        },
        answer: {
          type: "string",
          description: "choicesの中の1つと完全一致する正解"
        }
      }
    };

    const prompt = buildPrompt(mode, character);

    const MAX_ATTEMPTS = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await callGemini({
          prompt,
          schema,
        });

        const parsed = parseModelJson(result.text);
        const validated = validateQuiz(parsed);

        if (!validated.ok) {
          throw new Error(validated.reason);
        }

        return res.status(200).json(validated.data);
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error);

        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * attempt);
        }
      }
    }

    return res.status(500).json({
      error: "Gemini の返答がJSON形式として不正です",
      message: lastError ? lastError.message : "Unknown error"
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Server error",
      message: error.message
    });
  }
};

function normalizeMode(mode) {
  if (mode === "medium") return "medium";
  if (mode === "hard") return "hard";
  return "easy";
}

function normalizeCharacter(character) {
  if (character === "miko") return "miko";
  return "pekora";
}

function buildPrompt(mode, character) {
  const modeText = {
    easy: "初心者。かなり基本的な問題。",
    medium: "中級。少し知識が必要な問題。",
    hard: "上級。細かい知識が必要な問題。"
  }[mode];

  const characterText = {
    pekora: "兎田ぺこら",
    miko: "さくらみこ"
  }[character];

  return `
あなたはクイズ作成AIです。

テーマ: ホロライブ
対象キャラ: ${characterText}
難易度: ${modeText}

条件:
- 4択クイズを1問だけ作る
- 日本語
- 情報は"https://hololive.hololivepro.com/talents"、"https://seesaawiki.jp/hololivetv/"この2つのサイト以外のものは絶対使わない
- 事実と違う内容を作らない
- なるべくファンが楽しめる内容
- 選択肢は必ず4つ
- 正解は choices の中の1つと完全一致させる
- 必ずJSONのみを返す
- Markdown、説明文、前置き、コードフェンスは禁止

出力形式:
{
  "question": "問題文",
  "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "answer": "正解の選択肢"
}
`.trim();
}

async function callGemini({ prompt, schema }) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" +
      encodeURIComponent(process.env.GEMINI_API_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini API error: ${JSON.stringify(data)}`
    );
  }

  const text = extractGeminiText(data);

  if (!text) {
    throw new Error("Gemini から本文が返りませんでした");
  }

  return { text, raw: data };
}

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) return "";

  if (Array.isArray(candidate?.content?.parts)) {
    return candidate.content.parts.map((p) => p.text || "").join("");
  }

  if (typeof candidate?.content?.text === "string") {
    return candidate.content.text;
  }

  if (typeof candidate?.content === "string") {
    return candidate.content;
  }

  return "";
}

function parseModelJson(text) {
  if (typeof text !== "string") return null;

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const cleaned = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) return null;

      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
}

function validateQuiz(value) {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "JSON object ではありません" };
  }

  const { question, choices, answer } = value;

  if (typeof question !== "string" || !question.trim()) {
    return { ok: false, reason: "question が不正です" };
  }

  if (!Array.isArray(choices) || choices.length !== 4) {
    return { ok: false, reason: "choices は4件必要です" };
  }

  if (!choices.every((c) => typeof c === "string" && c.trim())) {
    return { ok: false, reason: "choices の要素が不正です" };
  }

  const uniqueChoices = new Set(choices.map((c) => c.trim()));
  if (uniqueChoices.size !== 4) {
    return { ok: false, reason: "choices に重複があります" };
  }

  if (typeof answer !== "string" || !answer.trim()) {
    return { ok: false, reason: "answer が不正です" };
  }

  if (!choices.includes(answer)) {
    return { ok: false, reason: "answer が choices のどれとも一致しません" };
  }

  return {
    ok: true,
    data: {
      question: question.trim(),
      choices: choices.map((c) => c.trim()),
      answer: answer.trim()
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
