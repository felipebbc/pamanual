/*
  PA Driver's Manual Quiz — Static Web App

  - Runs entirely in the browser (no server needed)
  - Loads question_bank.json at runtime
  - Supports shuffled answer choices
  - Supports "review missed questions only" mode

  Keep these filenames stable (user-requested):
  - question_bank.json
  - static/question_images/* (image names/paths)
*/

const APP_VERSION = "2.0.1-static";

const SETTINGS_KEY = "pa_quiz_settings";

const LETTERS = ["A", "B", "C", "D"];

function el(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function show(id, visible) {
  const node = el(id);
  if (!node) return;
  node.style.display = visible ? "" : "none";
}

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setError(id, msg) {
  const node = el(id);
  if (!node) return;
  if (msg) {
    node.textContent = msg;
    node.style.display = "";
  } else {
    node.textContent = "";
    node.style.display = "none";
  }
}

function isLikelyUrl(s) {
  return /^(https?:|data:|blob:)/i.test(s);
}

// In the Flask version, images lived under /static/ and JSON stored paths like "question_images/...".
// For this static version, we keep images in "static/question_images/..." so users can drop-in their
// modified files without renaming. This resolver preserves absolute/URL paths and prefixes "static/"
// when needed.
function resolveImageSrc(path) {
  if (!path) return "";
  const p = String(path).trim();
  if (!p) return "";

  if (isLikelyUrl(p)) return p;
  if (p.startsWith("/")) return p;
  if (p.startsWith("static/")) return p;

  // Most common: "question_images/xxx.png" -> "static/question_images/xxx.png"
  return "static/" + p;
}

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sampleWithoutReplacement(arr, n) {
  const copy = arr.slice();
  shuffleInPlace(copy);
  return copy.slice(0, n);
}

function extractQuestionsPayload(data) {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
  if (data && typeof data === "object") {
    if (Array.isArray(data.questions)) return data.questions.filter((x) => x && typeof x === "object");
    // fallback: first list-of-objects value
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object")) return v;
    }
  }
  return [];
}

function choicesToDict(choicesVal) {
  // dict shape
  if (choicesVal && typeof choicesVal === "object" && !Array.isArray(choicesVal)) {
    const out = {};
    for (const [k, v] of Object.entries(choicesVal)) {
      const kk = String(k).trim().toUpperCase();
      if (!LETTERS.includes(kk)) continue;
      if (typeof v !== "string") continue;
      out[kk] = v.trim();
    }
    if (LETTERS.every((l) => out[l])) return out;
    return null;
  }

  // list shape
  if (Array.isArray(choicesVal)) {
    const strings = choicesVal.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    if (strings.length >= 4) {
      return { A: strings[0], B: strings[1], C: strings[2], D: strings[3] };
    }
  }

  return null;
}

function extractAnswer(answerVal) {
  // "A"
  if (typeof answerVal === "string") {
    const c = answerVal.trim().toUpperCase();
    if (c && LETTERS.includes(c[0])) return { letter: c[0], text: null };
  }

  // {letter:"A", text:"..."}
  if (answerVal && typeof answerVal === "object") {
    const raw = answerVal.letter || answerVal.answer || answerVal.choice;
    if (typeof raw === "string") {
      const c = raw.trim().toUpperCase();
      if (c && LETTERS.includes(c[0])) {
        const t = typeof answerVal.text === "string" ? answerVal.text.trim() : null;
        return { letter: c[0], text: t || null };
      }
    }
  }

  return null;
}

function normalizeQuestions(rawData) {
  const payload = extractQuestionsPayload(rawData);

  const out = [];
  let skipped = 0;

  payload.forEach((obj, idx) => {
    const prompt = obj.question || obj.prompt || obj.q;
    if (typeof prompt !== "string" || !prompt.trim()) {
      skipped++;
      return;
    }

    const choices = choicesToDict(obj.choices || obj.options || obj.answers);
    if (!choices) {
      skipped++;
      return;
    }

    const ans = extractAnswer(obj.answer || obj.correct || obj.correctAnswer);
    if (!ans) {
      skipped++;
      return;
    }

    const chapter = Number.isFinite(Number(obj.chapter)) ? Number(obj.chapter) : null;
    const qnum = Number.isFinite(Number(obj.question_number || obj.questionNumber || obj.number))
      ? Number(obj.question_number || obj.questionNumber || obj.number)
      : null;

    let qid = obj.id;
    if (typeof qid !== "string" || !qid.trim()) {
      if (chapter != null && qnum != null) qid = `ch${chapter}-q${String(qnum).padStart(3, "0")}`;
      else qid = `q${String(idx + 1).padStart(4, "0")}`;
    }

    // Images
    const imagesVal = obj.images || obj.image;
    let images = [];
    if (typeof imagesVal === "string" && imagesVal.trim()) images = [imagesVal.trim()];
    else if (Array.isArray(imagesVal)) images = imagesVal.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);

    const answerText = ans.text || choices[ans.letter] || null;

    out.push({
      qid,
      chapter,
      question_number: qnum,
      question: prompt.trim(),
      choices,
      answerLetter: ans.letter,
      answerText,
      images,
    });
  });

  return { questions: out, skipped };
}

async function loadQuestionBank() {
  // Cache-bust with version.
  const url = `question_bank.json?v=${encodeURIComponent(APP_VERSION)}`;
  const resp = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!resp.ok) throw new Error(`Failed to load question_bank.json (HTTP ${resp.status})`);
  const data = await resp.json();
  return normalizeQuestions(data);
}

function setVersionText() {
  setText("appVersion", APP_VERSION);
}

// ---------------- Index page ----------------

async function initIndexPage() {
  setVersionText();

  const totalNode = el("totalQuestions");
  const numInput = el("num_questions");

  try {
    const { questions, skipped } = await loadQuestionBank();

    if (totalNode) totalNode.textContent = String(questions.length);
    if (numInput) {
      numInput.max = String(questions.length);
      // if default value > max, clamp
      numInput.value = String(clampInt(numInput.value, 1, questions.length));
    }

    if (skipped > 0) {
      // Not fatal; just inform in console.
      console.warn(`Skipped ${skipped} question entries that didn't match expected schema.`);
    }

  } catch (e) {
    console.error(e);
    if (totalNode) totalNode.textContent = "(error)";
    setError("startError", String(e && e.message ? e.message : e));
  }

  const form = el("startForm");
  if (!form) return;

  form.addEventListener("submit", (evt) => {
    evt.preventDefault();
    setError("startError", "");

    const nRaw = numInput ? numInput.value : "10";
    const shuffle = !!(el("shuffleChoices") && el("shuffleChoices").checked);

    // We'll clamp later on quiz page once we know the true total.
    const settings = {
      numQuestions: Number.parseInt(String(nRaw), 10) || 10,
      shuffleChoices: shuffle,
      createdAt: Date.now(),
      appVersion: APP_VERSION,
    };

    try {
      sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      // sessionStorage can be disabled; still proceed.
      console.warn("Could not save settings to sessionStorage.", err);
    }

    window.location.href = "quiz.html";
  });
}

// ---------------- Quiz page ----------------

const state = {
  ready: false,
  mode: "main",          // "main" | "review"
  shuffleChoices: true,

  // Lists
  bank: [],               // normalized question bank
  selected: [],           // questions for current run (main or review)
  missedMain: [],         // missed during main attempt
  stillMissed: [],        // missed during current review round

  // Counters
  index: 0,
  score: 0,
  reviewRound: 1,

  // Current render mapping
  current: null,          // { q, correctDisplayLetter, displayChoices }

  // For results
  lastResult: null,
};

function renderStatus() {
  const total = state.selected.length;
  const idx = Math.min(state.index + 1, total);
  const modeLabel = state.mode === "review" ? `Review missed (Round ${state.reviewRound})` : "Quiz";
  setText("status", `${modeLabel} • Score: ${state.score}/${Math.min(state.index, total)} • Question: ${idx}/${total}`);
}

function renderMeta(q) {
  const parts = [];
  if (q.chapter != null) parts.push(`Chapter ${q.chapter}`);
  if (q.question_number != null) parts.push(`Q${q.question_number}`);
  if (parts.length === 0) parts.push(q.qid);
  setText("meta", parts.join(" • "));
}

function openImageModal(src) {
  const modal = el("imgModal");
  const img = el("imgModalImg");
  if (!modal || !img) return;
  img.src = src;
  modal.style.display = "";
  modal.setAttribute("aria-hidden", "false");
}

function closeImageModal() {
  const modal = el("imgModal");
  const img = el("imgModalImg");
  if (!modal || !img) return;
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  img.src = "";
}

function wireModal() {
  const closeBtn = el("imgModalClose");
  const backdrop = el("imgModalBackdrop");
  if (closeBtn) closeBtn.addEventListener("click", closeImageModal);
  if (backdrop) backdrop.addEventListener("click", closeImageModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImageModal();
  });
}

function buildDisplayChoices(q) {
  const entries = LETTERS.map((letter) => ({ origLetter: letter, text: q.choices[letter] }));
  if (state.shuffleChoices) shuffleInPlace(entries);

  const displayChoices = {};
  let correctDisplayLetter = "A";

  for (let i = 0; i < 4; i++) {
    const dispLetter = LETTERS[i];
    const entry = entries[i];
    displayChoices[dispLetter] = entry.text;
    if (entry.origLetter === q.answerLetter) correctDisplayLetter = dispLetter;
  }

  return { displayChoices, correctDisplayLetter };
}

function disableChoiceButtons(disabled) {
  const container = el("choices");
  if (!container) return;
  container.querySelectorAll("button").forEach((b) => (b.disabled = disabled));
}

function renderImages(q) {
  const wrap = el("questionImages");
  if (!wrap) return;
  clearNode(wrap);

  const imgs = Array.isArray(q.images) ? q.images : [];
  if (!imgs.length) {
    wrap.style.display = "none";
    return;
  }

  imgs.forEach((p) => {
    const src = resolveImageSrc(p);
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Question image";
    img.className = "qimg";
    img.loading = "lazy";
    img.addEventListener("click", () => openImageModal(src));
    wrap.appendChild(img);
  });

  wrap.style.display = "";
}

function renderQuestion() {
  show("errorCard", false);
  show("resultCard", false);
  show("questionCard", true);

  setText("feedback", "");
  show("nextBtn", false);

  const q = state.selected[state.index];
  if (!q) {
    renderResults();
    return;
  }

  renderStatus();
  renderMeta(q);
  renderImages(q);
  setText("questionText", q.question);

  const { displayChoices, correctDisplayLetter } = buildDisplayChoices(q);
  state.current = { q, displayChoices, correctDisplayLetter };

  const choicesDiv = el("choices");
  clearNode(choicesDiv);

  LETTERS.forEach((letter) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.letter = letter;
    btn.textContent = `${letter}. ${displayChoices[letter]}`;
    btn.addEventListener("click", () => submitAnswer(letter));
    choicesDiv.appendChild(btn);
  });

  disableChoiceButtons(false);
}

function submitAnswer(letter) {
  if (!state.current) return;

  disableChoiceButtons(true);

  const { q, correctDisplayLetter, displayChoices } = state.current;
  const correct = letter === correctDisplayLetter;

  if (correct) {
    state.score += 1;
  } else {
    if (state.mode === "main") state.missedMain.push(q);
    else state.stillMissed.push(q);
  }

  const correctText = q.answerText || displayChoices[correctDisplayLetter] || "";

  const feedback = el("feedback");
  if (feedback) {
    feedback.textContent = correct
      ? `✅ Correct! (Answer: ${correctDisplayLetter}. ${correctText})`
      : `❌ Incorrect. Correct answer: ${correctDisplayLetter}. ${correctText}`;
  }

  const nextBtn = el("nextBtn");
  if (nextBtn) {
    nextBtn.textContent = state.index + 1 >= state.selected.length ? "View results" : "Next";
    nextBtn.onclick = () => {
      state.index += 1;
      state.current = null;
      renderQuestion();
    };
  }
  show("nextBtn", true);

  // Update status with the just-answered question counted.
  setText(
    "status",
    `${state.mode === "review" ? `Review missed (Round ${state.reviewRound})` : "Quiz"} • Score: ${state.score}/${state.index + 1} • Question: ${Math.min(state.index + 1, state.selected.length)}/${state.selected.length}`
  );
}

function renderResults() {
  show("questionCard", false);
  show("errorCard", false);
  show("resultCard", true);

  const total = state.selected.length;
  const score = state.score;
  const percent = total ? ((score / total) * 100).toFixed(1) : "0.0";

  const parts = [];

  if (state.mode === "main") {
    parts.push("Quiz complete");
    parts.push(`Score: ${score}/${total} (${percent}%)`);
    parts.push(`Missed: ${state.missedMain.length}`);

    setText("resultSummary", parts.join(" • "));

    // Review button logic
    const reviewBtn = el("reviewBtn");
    const reviewAgainBtn = el("reviewAgainBtn");
    if (reviewBtn) {
      reviewBtn.style.display = state.missedMain.length > 0 ? "" : "none";
      reviewBtn.onclick = () => startReview();
    }
    if (reviewAgainBtn) reviewAgainBtn.style.display = "none";

  } else {
    parts.push(`Review round ${state.reviewRound}`);
    parts.push(`Score: ${score}/${total} (${percent}%)`);

    const still = state.stillMissed.length;
    if (still === 0) parts.push("🎉 All missed questions cleared!");
    else parts.push(`Still missed: ${still}`);

    setText("resultSummary", parts.join(" • "));

    const reviewBtn = el("reviewBtn");
    const reviewAgainBtn = el("reviewAgainBtn");
    if (reviewBtn) reviewBtn.style.display = "none";

    if (reviewAgainBtn) {
      reviewAgainBtn.style.display = still > 0 ? "" : "none";
      reviewAgainBtn.onclick = () => startReviewAgain();
    }
  }
}

function startMainQuiz(bank, numQuestions, shuffleChoices) {
  state.ready = true;
  state.mode = "main";
  state.shuffleChoices = !!shuffleChoices;
  state.bank = bank;

  const total = bank.length;
  const n = clampInt(numQuestions, 1, total);

  state.selected = sampleWithoutReplacement(bank, n);
  state.index = 0;
  state.score = 0;
  state.missedMain = [];

  state.reviewRound = 1;
  state.stillMissed = [];
  state.current = null;

  renderQuestion();
}

function startReview() {
  if (!state.missedMain.length) return;

  state.mode = "review";
  state.reviewRound = 1;
  state.selected = sampleWithoutReplacement(state.missedMain, state.missedMain.length);
  state.index = 0;
  state.score = 0;
  state.stillMissed = [];
  state.current = null;

  renderQuestion();
}

function startReviewAgain() {
  if (!state.stillMissed.length) return;

  state.reviewRound += 1;
  state.selected = sampleWithoutReplacement(state.stillMissed, state.stillMissed.length);
  state.index = 0;
  state.score = 0;
  state.stillMissed = [];
  state.current = null;

  renderQuestion();
}

function showFatalError(message) {
  show("questionCard", false);
  show("resultCard", false);
  show("errorCard", true);
  setText("errorText", message);
}

async function initQuizPage() {
  setVersionText();
  wireModal();

  const resetBtn = el("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      try { sessionStorage.removeItem(SETTINGS_KEY); } catch (_) {}
      window.location.href = "index.html";
    });
  }

  // Load settings from sessionStorage.
  let settings = null;
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) settings = JSON.parse(raw);
  } catch (e) {
    settings = null;
  }

  // If user hits quiz page directly, fall back to defaults instead of failing.
  const desiredNum = settings && Number.isFinite(Number(settings.numQuestions)) ? Number(settings.numQuestions) : 20;
  const shuffleChoices = settings ? !!settings.shuffleChoices : true;

  try {
    const { questions, skipped } = await loadQuestionBank();
    if (!questions.length) {
      showFatalError("No usable questions found in question_bank.json.");
      return;
    }
    if (skipped > 0) {
      console.warn(`Skipped ${skipped} question entries that didn't match expected schema.`);
    }

    startMainQuiz(questions, desiredNum, shuffleChoices);
  } catch (e) {
    console.error(e);
    showFatalError(String(e && e.message ? e.message : e));
  }
}

// ---------------- Boot ----------------

document.addEventListener("DOMContentLoaded", () => {
  // If we're on index page
  if (el("startForm")) {
    initIndexPage();
    return;
  }

  // If we're on quiz page
  if (el("quizApp")) {
    initQuizPage();
    return;
  }
});
