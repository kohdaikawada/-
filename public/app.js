"use strict";

const STORAGE_KEY = "hololiveQuizStatsV2";
const REQUEST_TIMEOUT_MS = 22_000;
const KEY_TO_INDEX = Object.freeze({
  a: 0,
  1: 0,
  b: 1,
  2: 1,
  c: 2,
  3: 2,
  d: 3,
  4: 3
});

const state = {
  mode: "easy",
  character: "pekora",
  answerToken: "",
  locked: true,
  phase: "loading",
  questionNumber: 0,
  recentQuestions: [],
  requestSequence: 0,
  abortController: null,
  stats: loadStats()
};

const elements = {
  question: document.getElementById("question"),
  questionCount: document.getElementById("questionCount"),
  status: document.getElementById("status"),
  feed: document.getElementById("feed"),
  streak: document.getElementById("streak"),
  bestStreak: document.getElementById("bestStreak"),
  streakTop: document.getElementById("streakTop"),
  accuracyTop: document.getElementById("accuracyTop"),
  modeText: document.getElementById("modeText"),
  correctCount: document.getElementById("correctCount"),
  answeredCount: document.getElementById("answeredCount"),
  comboPct: document.getElementById("comboPct"),
  meter: document.querySelector(".meter"),
  meterFill: document.getElementById("meterFill"),
  resultPanel: document.getElementById("resultPanel"),
  resultTitle: document.getElementById("resultTitle"),
  explanation: document.getElementById("explanation"),
  sourceLinks: document.getElementById("sourceLinks"),
  primaryActionButton: document.getElementById("primaryActionButton"),
  resetStatsButton: document.getElementById("resetStatsButton"),
  modeControls: document.getElementById("modeControls"),
  characterControls: document.getElementById("characterControls")
};

const choiceButtons = [...document.querySelectorAll(".choice-btn")];
const choiceTextElements = choiceButtons.map((button) =>
  button.querySelector(".choice-text")
);

bindEvents();
renderStats();
renderControls();
loadQuiz();

function bindEvents() {
  elements.modeControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || button.dataset.mode === state.mode) return;
    state.mode = button.dataset.mode;
    renderControls();
    loadQuiz();
  });

  elements.characterControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-character]");
    if (!button || button.dataset.character === state.character) return;
    state.character = button.dataset.character;
    renderControls();
    loadQuiz();
  });

  choiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      submitAnswer(Number(button.dataset.index));
    });
  });

  elements.primaryActionButton.addEventListener("click", () => loadQuiz());
  elements.resetStatsButton.addEventListener("click", resetStats);
  document.addEventListener("keydown", handleKeyboardInput);
}

async function loadQuiz() {
  const sequence = ++state.requestSequence;
  state.abortController?.abort();
  state.abortController = new AbortController();

  state.locked = true;
  state.phase = "loading";
  state.answerToken = "";
  clearChoiceStyles();
  setChoicesEnabled(false);
  hideResult();
  setStatus("loading", "GENERATING");
  setFeed("参照ページを確認して問題を生成しています…");
  elements.question.textContent = "読み込み中です…";
  choiceTextElements.forEach((element) => {
    element.textContent = "";
  });
  elements.primaryActionButton.hidden = true;

  const timeoutId = setTimeout(() => state.abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: state.mode,
        character: state.character,
        excludeQuestions: state.recentQuestions
      }),
      signal: state.abortController.signal
    });

    const data = await parseJsonResponse(response);
    if (sequence !== state.requestSequence) return;

    if (!response.ok) {
      throw new Error(data.error || "問題の取得に失敗しました");
    }

    if (
      typeof data.question !== "string" ||
      !Array.isArray(data.choices) ||
      data.choices.length !== 4 ||
      typeof data.answerToken !== "string"
    ) {
      throw new Error("サーバーから不正なデータが返されました");
    }

    state.questionNumber += 1;
    state.answerToken = data.answerToken;
    state.recentQuestions = [...state.recentQuestions, data.question].slice(-6);
    elements.questionCount.textContent = `Q${state.questionNumber}`;
    elements.question.textContent = data.question;
    data.choices.forEach((choice, index) => {
      choiceTextElements[index].textContent = choice;
    });

    state.locked = false;
    state.phase = "answering";
    setStatus("", "READY");
    setFeed(`${modeLabel(state.mode)} / ${characterLabel(state.character)}`);
    setChoicesEnabled(true);
    choiceButtons[0].focus({ preventScroll: true });
  } catch (error) {
    if (sequence !== state.requestSequence) return;

    const message =
      error?.name === "AbortError"
        ? "生成に時間がかかっています。もう一度お試しください"
        : error.message || "問題の取得に失敗しました";

    state.phase = "error";
    setStatus("bad", "ERROR");
    setFeed(message);
    elements.question.textContent = "問題を読み込めませんでした";
    choiceTextElements.forEach((element) => {
      element.textContent = "—";
    });
    elements.primaryActionButton.textContent = "再試行";
    elements.primaryActionButton.hidden = false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function submitAnswer(selectedIndex) {
  if (state.locked || state.phase !== "answering") return;

  state.locked = true;
  setChoicesEnabled(false);
  setStatus("loading", "CHECKING");
  setFeed("回答を確認しています…");

  try {
    const response = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedIndex,
        answerToken: state.answerToken
      })
    });

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "回答を確認できませんでした");
    }

    showAnswerResult(selectedIndex, data);
  } catch (error) {
    state.phase = "error";
    setStatus("bad", "ERROR");
    setFeed(error.message || "回答を確認できませんでした");
    elements.primaryActionButton.textContent = "次の問題";
    elements.primaryActionButton.hidden = false;
  }
}

function showAnswerResult(selectedIndex, data) {
  const isCorrect = Boolean(data.correct);
  const correctIndex = Number(data.correctIndex);

  choiceButtons[selectedIndex]?.classList.add(isCorrect ? "correct" : "wrong");
  choiceButtons[correctIndex]?.classList.add("correct");

  state.stats.answered += 1;
  if (isCorrect) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    setStatus("good", "CORRECT");
    setFeed("正解です。連続正解を更新しました！");
    elements.resultTitle.textContent = "正解！";
  } else {
    state.stats.streak = 0;
    setStatus("bad", "MISS");
    setFeed(`正解は「${choiceTextElements[correctIndex]?.textContent || "—"}」です`);
    elements.resultTitle.textContent = "惜しい！";
  }

  saveStats();
  renderStats();
  showResult(data.explanation, data.sources);
  state.phase = "result";
  elements.primaryActionButton.textContent = "次の問題";
  elements.primaryActionButton.hidden = false;
  elements.primaryActionButton.focus({ preventScroll: true });
}

function showResult(explanation, sources) {
  elements.explanation.textContent = explanation || "解説はありません。";
  elements.sourceLinks.replaceChildren();

  if (Array.isArray(sources)) {
    sources.forEach((source, index) => {
      if (!source || typeof source.url !== "string") return;

      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title || `参照元 ${index + 1}`;
      elements.sourceLinks.append(link);
    });
  }

  elements.resultPanel.hidden = false;
}

function hideResult() {
  elements.resultPanel.hidden = true;
  elements.explanation.textContent = "";
  elements.sourceLinks.replaceChildren();
}

function renderControls() {
  elements.modeText.textContent = modeLabel(state.mode);

  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll("[data-character]").forEach((button) => {
    const active = button.dataset.character === state.character;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderStats() {
  const { streak, bestStreak, correct, answered } = state.stats;
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : null;
  const combo = Math.min(100, streak * 12.5);

  elements.streak.textContent = String(streak);
  elements.bestStreak.textContent = String(bestStreak);
  elements.streakTop.textContent = String(streak);
  elements.correctCount.textContent = String(correct);
  elements.answeredCount.textContent = String(answered);
  elements.accuracyTop.textContent = accuracy == null ? "--" : `${accuracy}%`;
  elements.comboPct.textContent = `${Math.round(combo)}%`;
  elements.meterFill.style.width = `${combo}%`;
  elements.meter.setAttribute("aria-valuenow", String(Math.round(combo)));
}

function setStatus(type, text) {
  elements.status.className = "status-pill";
  if (type) elements.status.classList.add(type);
  elements.status.textContent = text;
}

function setFeed(text) {
  elements.feed.textContent = text;
}

function setChoicesEnabled(enabled) {
  choiceButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function clearChoiceStyles() {
  choiceButtons.forEach((button) => {
    button.classList.remove("correct", "wrong");
  });
}

function handleKeyboardInput(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  if (state.phase === "answering") {
    const index = KEY_TO_INDEX[event.key.toLowerCase()];
    if (index !== undefined) {
      event.preventDefault();
      submitAnswer(index);
    }
    return;
  }

  if ((state.phase === "result" || state.phase === "error") && event.key === "Enter") {
    event.preventDefault();
    loadQuiz();
  }
}

function resetStats() {
  const confirmed = window.confirm("連続正解・ベスト・正解数をすべてリセットしますか？");
  if (!confirmed) return;

  state.stats = { streak: 0, bestStreak: 0, correct: 0, answered: 0 };
  saveStats();
  renderStats();
  setFeed("プレイ記録をリセットしました");
}

function loadStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      streak: toNonNegativeInteger(parsed.streak),
      bestStreak: toNonNegativeInteger(parsed.bestStreak),
      correct: toNonNegativeInteger(parsed.correct),
      answered: toNonNegativeInteger(parsed.answered)
    };
  } catch (_) {
    return { streak: 0, bestStreak: 0, correct: 0, answered: 0 };
  }
}

function saveStats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats));
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function modeLabel(mode) {
  return { easy: "初心者", medium: "中級", hard: "上級" }[mode] || "初心者";
}

function characterLabel(character) {
  return character === "miko" ? "さくらみこ" : "兎田ぺこら";
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("サーバーの応答を読み取れませんでした");
  }
}
