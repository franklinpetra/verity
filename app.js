// Verity: a board of AI advisors from different companies reads your documents, answers independently,
// debates once, and writes a decision brief with every document quote checked against the source.
// Everything runs in this tab; the only network calls go to OpenRouter with the person's own key.

import { BRAND, LIMITS, SEATS, SYNTHESIZER } from "./config.js";
import { ACCEPT, documentsText, pickRelevant, readDocument, tokensOf } from "./docs.js";
import { SeatError, ask, checkKey, modelCatalog } from "./llm.js";
import { render } from "./markdown.js";
import { blindMessages, decisionText, discussionMessages, synthesisMessages } from "./prompts.js";
import { checkCitations, flagList } from "./verify.js";

const $ = (id) => document.getElementById(id);
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEY_STORE = "verity-openrouter-key";
const OVERHEAD_TOKENS = 3_000; // instructions and the decision itself
const ANSWER_TOKENS = 2_500; // a typical written answer, for estimates
const THINKING_TOKENS = 4_000; // a typical amount of reasoning, for estimates

let docs = [];
let reading = 0;
let catalog = null;
let seated = new Set(SEATS.map((s) => s.id));
let controller = null;
let record = null; // the finished (or running) decision, for exports

// --- Brand ---------------------------------------------------------------------

document.title = BRAND.name;
$("wordmark").textContent = BRAND.name;
if (BRAND.maker) {
  $("maker").innerHTML = `<img src="${escape(BRAND.maker.logo)}" alt="" width="26" height="35" /><span>${escape(BRAND.maker.name)}</span>`;
}

// --- Key ------------------------------------------------------------------------

function getKey() {
  try {
    return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE) || "";
  } catch {
    return "";
  }
}

function setKey(key, remember) {
  try {
    sessionStorage.removeItem(KEY_STORE);
    localStorage.removeItem(KEY_STORE);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY_STORE, key);
  } catch {
    // Private windows can refuse storage; the key then lasts until the tab closes.
    memoryKey = key;
  }
  showKey();
}
let memoryKey = "";
const currentKey = () => getKey() || memoryKey;

function showKey() {
  const has = Boolean(currentKey());
  $("key-btn").classList.toggle("set", has);
  $("key-label").textContent = has ? "Key set" : "Add your key";
}

$("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("key-input").value.trim();
  const status = $("key-status");
  status.className = "key-status";
  if (!key) return (status.textContent = "Paste your OpenRouter key first.");
  status.textContent = "Checking the key…";
  try {
    const info = await checkKey(key);
    setKey(key, $("key-remember").checked);
    status.classList.add("good");
    status.textContent = info.remaining == null ? "Key saved." : `Key saved. About $${info.remaining.toFixed(2)} left on it.`;
    $("key-input").value = "";
    setTimeout(() => $("key").close(), 900);
  } catch (err) {
    status.classList.add("bad");
    status.textContent = err.message;
  }
});
$("key-forget").addEventListener("click", () => {
  setKey("", false);
  memoryKey = "";
  $("key-status").className = "key-status";
  $("key-status").textContent = "Key forgotten.";
});

// --- Panels -----------------------------------------------------------------------

document.querySelector(".topnav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-panel]");
  if (b) $(b.dataset.panel).showModal();
});
for (const panel of document.querySelectorAll("dialog.panel")) {
  panel.addEventListener("click", (e) => {
    if (e.target === panel || e.target.closest("[data-close]")) panel.close();
  });
}

// --- Documents ---------------------------------------------------------------------

const fileInput = $("files");
fileInput.accept = ACCEPT;
$("choose").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addFiles([...fileInput.files]);
  fileInput.value = "";
});
const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles([...e.dataTransfer.files]);
});

const sizeOf = (doc) => {
  const words = Math.round(doc.chars / 6);
  const unit = doc.kind === "PDF" ? "pages" : doc.kind === "PowerPoint" ? "slides" : doc.kind === "Excel" ? "sheets" : "parts";
  return `${doc.units.length} ${doc.units.length === 1 ? unit.slice(0, -1) : unit} · about ${words.toLocaleString()} words`;
};

function renderDocs(pending = []) {
  $("docs").innerHTML =
    docs
      .map(
        (d, i) => `<li class="doc"><span><span class="doc-name">${escape(d.name)}</span><br /><span class="doc-meta">${escape(d.kind)} · ${escape(sizeOf(d))}</span>${
          d.scannedPages.length ? `<br /><span class="doc-warn">${d.scannedPages.length} page${d.scannedPages.length === 1 ? "" : "s"} look scanned and couldn't be read (${escape(d.scannedPages.slice(0, 6).join(", "))}${d.scannedPages.length > 6 ? "…" : ""}).</span>` : ""
        }</span><button type="button" class="remove" data-remove="${i}" aria-label="Remove ${escape(d.name)}">×</button></li>`,
      )
      .join("") + pending.map((name) => `<li class="doc reading"><span class="doc-name">${escape(name)}</span> · reading…</li>`).join("");
  estimate();
}

async function addFiles(files) {
  $("form-error").textContent = "";
  const fresh = files.filter((f) => !docs.some((d) => d.name === f.name));
  if (!fresh.length) return;
  reading += fresh.length;
  const pending = fresh.map((f) => f.name);
  renderDocs(pending);
  for (const file of fresh) {
    try {
      docs.push(await readDocument(file));
    } catch (err) {
      $("form-error").textContent = err.message;
    }
    pending.shift();
    reading--;
    renderDocs(pending);
  }
}

$("docs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  docs.splice(Number(b.dataset.remove), 1);
  renderDocs();
});

// --- Seats ---------------------------------------------------------------------------

function renderSeats() {
  $("seats").innerHTML = SEATS.map(
    (s) => `<button type="button" class="seat" data-seat="${s.id}" aria-pressed="${seated.has(s.id)}"><span class="dot" aria-hidden="true"></span>${escape(s.name)} <span class="co">${escape(s.maker)}</span></button>`,
  ).join("");
  // Colours are set through the DOM, since the security policy blocks inline style attributes.
  for (const b of $("seats").querySelectorAll("[data-seat]")) b.style.setProperty("--seat", seatById(b.dataset.seat).color);
}
$("seats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-seat]");
  if (!b) return;
  const id = b.dataset.seat;
  if (seated.has(id)) {
    if (seated.size <= 2) return ($("form-error").textContent = "A board needs at least two advisors.");
    seated.delete(id);
  } else seated.add(id);
  $("form-error").textContent = "";
  renderSeats();
  estimate();
});

// --- Fitting documents and estimating cost --------------------------------------------

const allDocChars = () => docs.reduce((n, d) => n + d.chars, 0);

/** How many characters of documents a model can take, leaving room for instructions, answers and its reply. */
function docBudgetChars(model, answersTokens) {
  const ctx = catalog?.[model]?.context || 128_000;
  return Math.max(0, (ctx - LIMITS.replyTokens - OVERHEAD_TOKENS - answersTokens) * 4 * 0.9);
}

/** The documents text a seat will receive at a given step: everything, or the most relevant sections. */
function docsFor(model, decision, answersTokens) {
  if (!docs.length) return { text: "", excerpt: false };
  const budget = docBudgetChars(model, answersTokens);
  if (allDocChars() * 1.05 <= budget) return { text: documentsText(docs), excerpt: false };
  return { text: documentsText(docs, pickRelevant(docs, decision, budget)), excerpt: true };
}

function estimate() {
  const el = $("estimate");
  if (reading) return (el.textContent = "Reading documents…");
  const seats = SEATS.filter((s) => seated.has(s.id));
  if (!catalog) return (el.textContent = `${seats.length} advisors · 3 steps`);
  const docTokens = tokensOf(allDocChars());
  const n = seats.length;
  let low = 0;
  const excerpted = [];
  for (const s of seats) {
    const m = catalog[s.model];
    if (!m) continue;
    const fit = Math.min(docTokens, docBudgetChars(s.model, n * ANSWER_TOKENS * 2) / 4);
    if (fit < docTokens) excerpted.push(s.name);
    const out = (ANSWER_TOKENS + THINKING_TOKENS) * m.outPrice;
    const reread = m.cachePrice || m.inPrice;
    low += (fit + OVERHEAD_TOKENS) * m.inPrice + out; // independent answer
    low += fit * reread + (OVERHEAD_TOKENS + n * ANSWER_TOKENS) * m.inPrice + out; // debate
    if (s.id === (seated.has(SYNTHESIZER) ? SYNTHESIZER : seats[0].id)) {
      low += fit * reread + (OVERHEAD_TOKENS + 2 * n * ANSWER_TOKENS) * m.inPrice + (ANSWER_TOKENS * 2 + THINKING_TOKENS) * m.outPrice;
    }
  }
  const web = $("web").checked ? n * 2 * LIMITS.webResults * 0.004 : 0;
  const words = docs.length ? ` · reading about ${Math.round(allDocChars() / 6).toLocaleString()} words` : "";
  const range = `$${(low + web).toFixed(2)}–$${((low + web) * 1.8).toFixed(2)}`;
  el.innerHTML = `${n} advisors · 3 steps${escape(words)} · <strong>about ${range}</strong> on your OpenRouter key${
    excerpted.length ? `<br /><span class="muted">${escape(excerpted.join(", "))} will read the most relevant sections, since the documents are longer than ${excerpted.length === 1 ? "it" : "they"} can take at once.</span>` : ""
  }`;
}
$("web").addEventListener("change", estimate);

// --- Running a decision -------------------------------------------------------------------

const seatById = (id) => SEATS.find((s) => s.id === id);

function card(round, seat) {
  return $(`card-${round}-${seat.id}`);
}

function showCard(round, seat, state, html = "", failed = false) {
  let el = card(round, seat);
  if (!el) {
    el = document.createElement("details");
    el.id = `card-${round}-${seat.id}`;
    el.className = "card";
    el.style.setProperty("--seat", seat.color);
    $(`cards-${round}`).append(el);
  }
  el.classList.toggle("working", !html && !failed);
  el.classList.toggle("failed", failed);
  el.innerHTML = `<summary><span class="who">${escape(seat.name)}</span><span class="co">${escape(seat.maker)}</span><span class="state">${escape(state)}</span></summary>${html ? `<div class="md">${html}</div>` : ""}`;
}

function answerHtml(result) {
  const sources = result.sources?.length
    ? `<p class="sources"><strong>Web sources:</strong> ${result.sources.map((s) => `<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title)}</a>`).join(" · ")}</p>`
    : "";
  return render(result.text, result.checks) + sources;
}

const checkSummary = (checks) => {
  const ok = checks.filter((c) => c.status === "verified").length;
  const moved = checks.filter((c) => c.status === "elsewhere").length;
  const bad = checks.length - ok - moved;
  return { ok, moved, bad, total: checks.length };
};

function stateLine(result) {
  const s = checkSummary(result.checks);
  if (!s.total) return "answered";
  return `answered · ${s.ok}/${s.total} quotes found${s.moved ? ` · ${s.moved} on another page` : ""}${s.bad ? ` · ${s.bad} not found` : ""}`;
}

function setStep(step, state) {
  const li = document.querySelector(`#steps [data-step="${step}"]`);
  li.classList.toggle("active", state === "active");
  li.classList.toggle("done", state === "done");
}

let spent = 0;
const addCost = (c) => {
  spent += c;
  $("spent").textContent = spent ? `Spent so far: $${spent.toFixed(2)}` : "";
};

/** Runs one step for several seats at once; a seat that fails is shown as failed and the rest carry on. */
async function step(round, seats, build) {
  for (const s of seats) showCard(round, s, "thinking…");
  const results = await Promise.all(
    seats.map(async (s) => {
      const { messages, excerpt } = build(s);
      try {
        const r = await ask({ key: currentKey(), model: s.model, messages, web: $("web").checked, signal: controller.signal });
        addCost(r.cost);
        r.checks = checkCitations(r.text, docs);
        r.excerpt = excerpt;
        showCard(round, s, stateLine(r) + (excerpt ? " · read excerpts" : ""), answerHtml(r));
        return [s.id, r];
      } catch (err) {
        const why = err instanceof SeatError ? err.message : "Something went wrong.";
        if (!(err instanceof SeatError)) console.error(err);
        showCard(round, s, `failed: ${why}`, "", true);
        return [s.id, { failed: why }];
      }
    }),
  );
  return new Map(results);
}

const answered = (map) => [...map].filter(([, r]) => !r.failed);

async function convene() {
  const fields = {
    decision: $("decision").value,
    options: $("options").value,
    criteria: $("criteria").value,
    context: $("context").value,
  };
  const decision = decisionText(fields);
  const seats = SEATS.filter((s) => seated.has(s.id));
  record = { at: new Date(), fields, docs: docs.map((d) => ({ name: d.name, kind: d.kind, size: sizeOf(d) })), seats, blind: null, debate: null, brief: null, web: $("web").checked };
  controller = new AbortController();
  spent = 0;
  addCost(0);

  $("run").hidden = false;
  $("brief").hidden = true;
  $("round-debate").hidden = true;
  $("cards-blind").innerHTML = "";
  $("cards-debate").innerHTML = "";
  $("stop").hidden = false;
  $("again").hidden = true;
  $("run-note").textContent = "";
  for (const s of ["blind", "debate", "brief"]) setStep(s, "");
  $("go").disabled = true;
  $("run").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  try {
    // 1. Independent answers, each advisor alone.
    setStep("blind", "active");
    const blind = await step("blind", seats, (s) => {
      const d = docsFor(s.model, decision, 0);
      return { messages: blindMessages({ model: s.model, documents: d.text, decision }), excerpt: d.excerpt };
    });
    record.blind = blind;
    setStep("blind", "done");
    if (controller.signal.aborted) return finish("Stopped.");
    const blindDone = answered(blind);
    if (blindDone.length < 2) return finish("Fewer than two advisors answered, so there's no board to debate. Check your key and credits, then try again.");

    // 2. Debate: everyone reads everyone, with the quote check's flags.
    const blindAnswers = blindDone.map(([id, r]) => ({ name: seatById(id).name, text: r.text }));
    const blindFlags = flagList(blindDone.map(([id, r]) => [seatById(id).name, r.checks]));
    const debaters = blindDone.map(([id]) => seatById(id));
    const answersTokens = tokensOf(blindAnswers.reduce((n, a) => n + a.text.length, 0));
    $("round-debate").hidden = false;
    setStep("debate", "active");
    const debate = await step("debate", debaters, (s) => {
      const d = docsFor(s.model, decision, answersTokens);
      return { messages: discussionMessages({ model: s.model, documents: d.text, decision, self: s.name, answers: blindAnswers, quoteFlags: blindFlags }), excerpt: d.excerpt };
    });
    record.debate = debate;
    setStep("debate", "done");
    if (controller.signal.aborted) return finish("Stopped.");

    // 3. The brief, written by the synthesizer (or the first advisor who answered, if it couldn't).
    const debateDone = answered(debate);
    const writer = seatById(debateDone.some(([id]) => id === SYNTHESIZER) ? SYNTHESIZER : (debateDone[0] || blindDone[0])[0]);
    const debateAnswers = debateDone.map(([id, r]) => ({ name: seatById(id).name, text: r.text }));
    const allFlags = [blindFlags, flagList(debateDone.map(([id, r]) => [seatById(id).name, r.checks]))].filter(Boolean).join("\n");
    const allTokens = answersTokens + tokensOf(debateAnswers.reduce((n, a) => n + a.text.length, 0));
    setStep("brief", "active");
    const d = docsFor(writer.model, decision, allTokens);
    try {
      const r = await ask({
        key: currentKey(),
        model: writer.model,
        messages: synthesisMessages({ model: writer.model, documents: d.text, decision, blind: blindAnswers, discussion: debateAnswers, quoteFlags: allFlags }),
        web: false,
        signal: controller.signal,
      });
      addCost(r.cost);
      r.checks = checkCitations(r.text, docs);
      r.writer = writer;
      r.excerpt = d.excerpt;
      record.brief = r;
      showBrief(r, blind, debate);
      setStep("brief", "done");
      finish();
    } catch (err) {
      finish(`The brief couldn't be written: ${err instanceof SeatError ? err.message : "something went wrong"}. The answers and debate are below.`);
    }
  } catch (err) {
    console.error(err);
    finish("Something went wrong. The answers so far are below.");
  }
}

function showBrief(r, blind, debate) {
  const all = [...answered(blind), ...answered(debate)].flatMap(([, x]) => x.checks).concat(r.checks);
  const s = checkSummary(all);
  const missing = [...blind].filter(([, x]) => x.failed).map(([id]) => seatById(id).name);
  $("checks").innerHTML = [
    `Written by ${escape(r.writer.name)} from ${answered(blind).length} independent answers and ${answered(debate).length} debate responses.`,
    s.total ? `<strong>${s.total} document quotes checked:</strong> ${s.ok} found${s.moved ? `, ${s.moved} on a different page` : ""}${s.bad ? `, <strong>${s.bad} not found</strong>` : ""}.` : docs.length ? "No document quotes were cited." : "",
    missing.length ? `Missing: ${escape(missing.join(", "))}.` : "",
    r.excerpt || [...blind.values()].some((x) => x.excerpt) ? "Some advisors read excerpts of the documents." : "",
  ]
    .filter(Boolean)
    .join(" ");
  $("brief-body").innerHTML = render(r.text, r.checks);
  $("brief").hidden = false;
  $("brief").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function finish(message = "") {
  $("go").disabled = false;
  $("stop").hidden = true;
  $("again").hidden = false;
  $("run-note").textContent = message;
}

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  $("form-error").textContent = "";
  if (!$("decision").value.trim()) {
    $("form-error").textContent = "Describe the decision first.";
    return $("decision").focus();
  }
  if (!currentKey()) {
    $("form-error").textContent = "Add your OpenRouter key to convene the board.";
    return $("key").showModal();
  }
  if (reading) return ($("form-error").textContent = "Still reading your documents. One moment.");
  const unknown = SEATS.filter((s) => seated.has(s.id) && catalog && !catalog[s.model]);
  if (unknown.length) return ($("form-error").textContent = `${unknown.map((s) => s.name).join(", ")} isn't available on OpenRouter right now. Unseat ${unknown.length === 1 ? "it" : "them"} to continue.`);
  convene();
});

$("stop").addEventListener("click", () => controller?.abort());
$("again").addEventListener("click", () => {
  $("run").hidden = true;
  $("form-error").textContent = "";
  $("decision").focus();
  scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});

// --- Exports -------------------------------------------------------------------------------

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => record.at.toISOString().slice(0, 10);
const checkNote = (checks) =>
  checks
    .filter((c) => c.status !== "verified")
    .map((c) => `- "${c.quote}" (${c.file}, ${c.label}): ${c.status === "elsewhere" ? `found on ${c.foundAt}` : "NOT found in the documents"}`)
    .join("\n");

function header() {
  const f = record.fields;
  return [
    `Decision: ${f.decision.trim()}`,
    f.options.trim() && `\nOptions:\n${f.options.trim()}`,
    f.criteria.trim() && `\nWhat matters most:\n${f.criteria.trim()}`,
    f.context.trim() && `\nContext:\n${f.context.trim()}`,
    record.docs.length ? `\nDocuments: ${record.docs.map((d) => `${d.name} (${d.size})`).join("; ")}` : "",
    `\nBoard: ${record.seats.map((s) => `${s.name} (${s.model})`).join(", ")}. Web search ${record.web ? "on" : "off"}. ${stamp()}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

$("dl-brief").addEventListener("click", () => {
  const b = record.brief;
  const flagged = checkNote(b.checks);
  download(`${BRAND.name} brief ${stamp()}.md`, `${b.text}\n\n---\n${header()}\nBrief written by ${b.writer.name}.${flagged ? `\n\nQuotes in this brief that weren't found on the cited page:\n${flagged}` : ""}\n`);
});

$("dl-record").addEventListener("click", () => {
  const section = (title, map) =>
    `# ${title}\n\n` +
    [...map]
      .map(([id, r]) => {
        const s = seatById(id);
        if (r.failed) return `## ${s.name} (${s.maker})\n\nFailed: ${r.failed}`;
        const flagged = checkNote(r.checks);
        const src = r.sources?.length ? `\n\nWeb sources:\n${r.sources.map((x) => `- ${x.title}: ${x.url}`).join("\n")}` : "";
        return `## ${s.name} (${s.maker})\n\n${r.text}${src}${flagged ? `\n\nQuote check:\n${flagged}` : ""}`;
      })
      .join("\n\n");
  const parts = [`# ${BRAND.name}: full record\n\n${header()}`, record.brief && record.brief.text, record.blind && section("Independent answers", record.blind), record.debate && section("Debate", record.debate)];
  download(`${BRAND.name} record ${stamp()}.md`, parts.filter(Boolean).join("\n\n---\n\n") + "\n");
});

$("print").addEventListener("click", () => window.print());
// Closed answer cards don't print, so open them all for printing and restore afterwards.
let closedForPrint = [];
addEventListener("beforeprint", () => {
  closedForPrint = [...document.querySelectorAll(".card:not([open])")];
  closedForPrint.forEach((d) => (d.open = true));
});
addEventListener("afterprint", () => closedForPrint.forEach((d) => (d.open = false)));

// --- Start ---------------------------------------------------------------------------------

showKey();
renderSeats();
estimate();
modelCatalog()
  .then((c) => {
    catalog = c;
    estimate();
  })
  .catch(() => {
    $("estimate").textContent = "Couldn't load OpenRouter's model list, so there's no cost estimate. Runs still work.";
  });
