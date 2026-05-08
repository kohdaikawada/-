module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const mode = body.mode || "easy";
    const character = body.character || "pekora";

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY が設定されていません" });
    }

    const modeText = {
      easy: "初心者。かなり基本的な問題。",
      medium: "中級。少し知識が必要な問題。",
      hard: "上級。細かい知識が必要な問題。"
    }[mode] || "初心者。かなり基本的な問題。";

    const characterText = {
      pekora: "兎田ぺこら",
      miko: "さくらみこ"
    }[character] || "兎田ぺこら";

    const prompt = `
あなたはクイズ作成AIです。

テーマ: ホロライブ
対象キャラ: ${characterText}
難易度: ${modeText}

条件:
- 4択クイズを1問だけ作る
- 日本語
- 実在情報のみ
- 事実と違う内容を作らない
- なるべくファンが楽しめる内容
- 選択肢は必ず4つ
- 正解は choices の中の1つと完全一致させる
- 必ずJSONのみを返す
- Markdownや説明文は一切付けない

出力形式:
{
  "question": "問題文",
  "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "answer": "正解の選択肢"
}
`.trim();

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
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
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 512,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Gemini API error",
        details: data
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      "";

    const parsed = safeParseJson(text);

    if (
      !parsed ||
      typeof parsed.question !== "string" ||
      !Array.isArray(parsed.choices) ||
      parsed.choices.length !== 4 ||
      typeof parsed.answer !== "string" ||
      !parsed.choices.includes(parsed.answer)
    ) {
      return res.status(500).json({
        error: "Gemini の返答がJSON形式として不正です",
        raw: text
      });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Server error",
      message: error.message
    });
  }
};

function safeParseJson(text) {
  if (!text) return null;

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const withoutFence = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch (_) {
      const start = withoutFence.indexOf("{");
      const end = withoutFence.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) return null;

      try {
        return JSON.parse(withoutFence.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
}