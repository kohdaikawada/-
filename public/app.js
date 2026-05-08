let mode = "easy";
let character = "pekora";
let currentAnswer = "";
let streak = Number(localStorage.getItem("streak") || 0);
let bestStreak = Number(localStorage.getItem("bestStreak") || 0);
let locked = false;

const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");
const feedEl = document.getElementById("feed");
const streakEl = document.getElementById("streak");
const bestStreakEl = document.getElementById("bestStreak");
const streakTopEl = document.getElementById("streakTop");
const modeTextEl = document.getElementById("modeText");
const charTextEl = document.getElementById("charText");
const comboPctEl = document.getElementById("comboPct");
const meterFillEl = document.getElementById("meterFill");

const choiceButtons = [
  document.getElementById("choice0"),
  document.getElementById("choice1"),
  document.getElementById("choice2"),
  document.getElementById("choice3")
];

const choiceTextEls = choiceButtons.map((btn) => btn.querySelector(".choice-text"));

streakEl.innerText = streak;
bestStreakEl.innerText = bestStreak;
streakTopEl.innerText = streak;
updateComboMeter();
updateTopLabels();
setActiveButtons();

function modeLabel(m) {
  if (m === "easy") return "初心者";
  if (m === "medium") return "中級";
  return "上級";
}

function charLabel(c) {
  if (c === "pekora") return "ぺこら";
  return "みこち";
}

function updateTopLabels() {
  modeTextEl.innerText = modeLabel(mode);
  charTextEl.innerText = charLabel(character);
}

function setActiveButtons() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.innerText === modeLabel(mode));
  });

  document.querySelectorAll(".char-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.innerText === charLabel(character));
  });
}

function setStatus(type, text) {
  statusEl.className = "status-pill";
  if (type) statusEl.classList.add(type);
  statusEl.innerText = text;
}

function setFeed(text) {
  feedEl.innerText = text;
}

function setChoiceButtonsEnabled(enabled) {
  choiceButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
}

function clearChoiceStyles() {
  choiceButtons.forEach((btn) => {
    btn.classList.remove("correct", "wrong");
  });
}

function updateComboMeter() {
  const pct = Math.min(100, streak * 12.5);
  meterFillEl.style.width = `${pct}%`;
  comboPctEl.innerText = `${Math.round(pct)}%`;
}

function saveStreaks() {
  localStorage.setItem("streak", String(streak));
  localStorage.setItem("bestStreak", String(bestStreak));
}

function animatePulse() {
  statusEl.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.03)" },
      { transform: "scale(1)" }
    ],
    { duration: 220, easing: "ease-out" }
  );
}

async function loadQuiz() {
  try {
    locked = true;
    setChoiceButtonsEnabled(false);
    clearChoiceStyles();
    setStatus("loading", "GENERATING");
    setFeed("新しいクイズを生成しています…");
    questionEl.innerText = "Loading...";
    choiceTextEls.forEach((el) => (el.innerText = ""));

    const res = await fetch("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, character })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "問題の取得に失敗しました");
    }

    questionEl.innerText = data.question;
    currentAnswer = data.answer;

    data.choices.forEach((choice, i) => {
      if (choiceTextEls[i]) choiceTextEls[i].innerText = choice;
    });

    setStatus("", "READY");
    setFeed(`難易度: ${modeLabel(mode)} / キャラ: ${charLabel(character)}`);
    setChoiceButtonsEnabled(true);
    locked = false;
    animatePulse();
  } catch (error) {
    console.error(error);
    setStatus("bad", "ERROR");
    setFeed(error.message || "不明なエラー");
    questionEl.innerText = "問題の取得に失敗しました";
    choiceTextEls.forEach((el) => (el.innerText = "—"));
    setChoiceButtonsEnabled(false);
    locked = false;
  }
}

function showResult(ok, correctText) {
  if (ok) {
    setStatus("good", "CORRECT");
    setFeed("正解！コンボが伸びた！");
  } else {
    setStatus("bad", "MISS");
    setFeed(`不正解。正解は「${correctText}」`);
  }

  animatePulse();
}

function answer(i) {
  if (locked) return;

  const selected = choiceTextEls[i].innerText;
  clearChoiceStyles();

  const isCorrect = selected === currentAnswer;

  if (isCorrect) {
    streak += 1;
    if (streak > bestStreak) bestStreak = streak;
    choiceButtons[i].classList.add("correct");
    showResult(true, currentAnswer);
  } else {
    streak = 0;
    choiceButtons[i].classList.add("wrong");
    choiceButtons.forEach((btn, idx) => {
      if (choiceTextEls[idx].innerText === currentAnswer) {
        btn.classList.add("correct");
      }
    });
    showResult(false, currentAnswer);
  }

  saveStreaks();
  streakEl.innerText = streak;
  bestStreakEl.innerText = bestStreak;
  streakTopEl.innerText = streak;
  updateComboMeter();

  setChoiceButtonsEnabled(false);
  locked = true;

  setTimeout(() => {
    loadQuiz();
  }, 1100);
}

function setMode(m) {
  mode = m;
  updateTopLabels();
  setActiveButtons();
  loadQuiz();
}

function setChar(c) {
  character = c;
  updateTopLabels();
  setActiveButtons();
  loadQuiz();
}

function resetStreak() {
  streak = 0;
  saveStreaks();
  streakEl.innerText = streak;
  streakTopEl.innerText = streak;
  updateComboMeter();
  setFeed("ストリークをリセットしました");
  setStatus("", "READY");
}

setActiveButtons();
loadQuiz();