// Verity: a board of AI advisors from different companies reads your documents, answers independently,
// debates once, and writes a decision brief with every document quote checked against the source.
// Everything runs in this tab; the only network calls go to OpenRouter with the person's own key.

import { ADDED_COLORS, BRAND, LIMITS, MAX_SEATS, SEATS, SYNTHESIZER, WEB_SEARCH_DEFAULT } from "./config.js";
import { ACCEPT, documentsText, pickRelevant, readDocument, tokensOf } from "./docs.js";
import { SeatError, ask, checkKey, modelCatalog } from "./llm.js";
import { render } from "./markdown.js";
import { ANOTHER_ROUND, blindMessages, decisionText, discussionMessages, partingThought, synthesisMessages } from "./prompts.js";
import { checkCitations, flagList } from "./verify.js";

const $ = (id) => document.getElementById(id);
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEY_STORE = "verity-openrouter-key";
const TURN_STORE = "verity-writer-turn"; // whose turn it is to write the brief
const OVERHEAD_TOKENS = 3_000; // instructions and the decision itself
const ANSWER_TOKENS = 2_500; // a typical written answer, for estimates

let docs = [];
let reading = 0;
let catalog = null;
// The board on offer: the configured seats plus any advisor the person adds from OpenRouter's list.
let board = [...SEATS];
let seated = new Set(SEATS.map((s) => s.id));
let usageAtStart = null; // what the key had spent when this decision began, to read the exact charge
let controller = null;
let record = null; // the finished (or running) decision, for exports

// --- Brand ---------------------------------------------------------------------

document.title = BRAND.name;
// A site that embeds Verity may replace the wordmark with its own navigation.
if ($("wordmark")) $("wordmark").textContent = BRAND.name;
if (BRAND.maker) {
  $("maker").innerHTML = `<img src="${escape(BRAND.maker.logo)}" alt="${escape(BRAND.maker.name)}" width="24" height="32" />`;
}
if (BRAND.feedback) {
  const { name, email } = BRAND.feedback;
  const subject = encodeURIComponent(`${BRAND.name} feedback`);
  $("feedback").innerHTML = `Please <a href="mailto:${escape(email)}?subject=${subject}">email</a> if something isn't working, or you have an idea for a new feature – ${escape(name)}${BRAND.maker ? ` of ${escape(BRAND.maker.name)}` : ""}`;
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
  // Documents being read or already read keep their section open.
  if (docs.length || pending.length) $("docs-more").open = true;
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
  $("seats").innerHTML =
    board
      .map(
        (s) => `<button type="button" class="seat" data-seat="${escape(s.id)}" aria-pressed="${seated.has(s.id)}"><span class="dot" aria-hidden="true"></span>${escape(s.name)} <span class="co">${escape(s.maker)}</span></button>`,
      )
      .join("") + `<button type="button" class="seat add-seat" id="add-seat">+ Add an advisor</button>`;
  // Colours are set through the DOM, since the security policy blocks inline style attributes.
  for (const b of $("seats").querySelectorAll("[data-seat]")) b.style.setProperty("--seat", seatById(b.dataset.seat).color);
  $("seat-count").textContent = `· tap to seat or unseat · ${seated.size} of ${MAX_SEATS} seats filled (at least 2)`;
}
$("seats").addEventListener("click", (e) => {
  if (e.target.closest("#add-seat")) return openAdd();
  const b = e.target.closest("[data-seat]");
  if (!b) return;
  const id = b.dataset.seat;
  if (seated.has(id)) {
    if (seated.size <= 2) return ($("form-error").textContent = "A board needs at least two advisors.");
    seated.delete(id);
  } else {
    if (seated.size >= MAX_SEATS) return ($("form-error").textContent = `The board has ${MAX_SEATS} seats. Unseat someone first.`);
    seated.add(id);
  }
  $("form-error").textContent = "";
  renderSeats();
  estimate();
});

// --- Adding advisors from OpenRouter's list -------------------------------------------------

function openAdd() {
  $("add-search").value = "";
  renderAdd();
  $("add").showModal();
  $("add-search").focus();
}

function renderAdd() {
  const list = $("add-list");
  if (!catalog) return (list.innerHTML = `<li class="muted small">Loading OpenRouter's list…</li>`);
  const words = $("add-search").value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = Object.entries(catalog)
    .filter(([id, m]) => m.writes && !id.endsWith(":free") && !board.some((s) => s.model === id))
    .filter(([id, m]) => words.every((w) => `${id} ${m.name} ${m.maker}`.toLowerCase().includes(w)))
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .slice(0, 60);
  list.innerHTML = matches.length
    ? matches
        .map(
          ([id, m]) =>
            `<li><button type="button" class="add-item" data-model="${escape(id)}"><strong>${escape(m.name)}</strong> <span class="co">${escape(m.maker)}</span><span class="add-price">$${(m.inPrice * 1e6).toFixed(2)} / $${(m.outPrice * 1e6).toFixed(2)} per million tokens</span></button></li>`,
        )
        .join("")
    : `<li class="muted small">No models match that search.</li>`;
}

$("add-search").addEventListener("input", renderAdd);
$("add-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-model]");
  if (!b) return;
  const id = b.dataset.model;
  const m = catalog[id];
  const used = new Set(board.map((s) => s.color));
  board.push({
    id,
    name: m.name,
    maker: m.maker,
    model: id,
    color: ADDED_COLORS.find((c) => !used.has(c)) || ADDED_COLORS[board.length % ADDED_COLORS.length],
  });
  if (seated.size < MAX_SEATS) seated.add(id);
  $("add").close();
  $("form-error").textContent = seated.has(id) ? "" : `${m.name} is on the bench: the board is full, so unseat someone to seat it.`;
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
  const seats = board.filter((s) => seated.has(s.id));
  const n = seats.length;
  const docTokens = tokensOf(allDocChars());
  // Who will read excerpts because the documents are longer than they can take at once.
  const excerpted = catalog
    ? seats.filter((s) => catalog[s.model] && docBudgetChars(s.model, n * ANSWER_TOKENS * 2) / 4 < docTokens).map((s) => s.name)
    : [];
  const words = docs.length ? ` · reading about ${Math.round(allDocChars() / 6).toLocaleString()} words` : "";
  el.innerHTML = `${n} advisors · 3 steps${escape(words)} · the price depends on the advisors chosen: <strong>about $0.25–$2.25</strong> on your OpenRouter key${
    excerpted.length ? `<br /><span class="muted">${escape(excerpted.join(", "))} will read the most relevant sections, since the documents are longer than ${excerpted.length === 1 ? "it" : "they"} can take at once.</span>` : ""
  }`;
}
$("web").addEventListener("change", estimate);

// --- Running a decision -------------------------------------------------------------------

const seatById = (id) => board.find((s) => s.id === id);

function showCard(round, container, seat, state, html = "", failed = false) {
  const id = `card-${container}-${seat.id}`;
  let el = $(id);
  if (!el) {
    el = document.createElement("details");
    el.id = id;
    el.className = "card";
    el.style.setProperty("--seat", seat.color);
    $(container).append(el);
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

const seconds = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`);

/** Runs one step for several seats at once; a seat that fails is shown as failed and the rest carry on. */
async function step(round, container, seats, build) {
  for (const s of seats) showCard(round, container, s, "thinking…");
  const started = performance.now();
  const results = await Promise.all(
    seats.map(async (s) => {
      const { messages, excerpt } = build(s);
      const t0 = performance.now();
      try {
        const r = await ask({ key: currentKey(), model: s.model, messages, web: $("web").checked, signal: controller.signal });
        addCost(r.cost);
        r.ms = performance.now() - t0;
        r.checks = checkCitations(r.text, docs);
        r.excerpt = excerpt;
        showCard(round, container, s, stateLine(r) + (excerpt ? " · read excerpts" : ""), answerHtml(r));
        return [s.id, r];
      } catch (err) {
        const why = err instanceof SeatError ? err.message : "Something went wrong.";
        if (!(err instanceof SeatError)) console.error(err);
        showCard(round, container, s, `failed: ${why}`, "", true);
        return [s.id, { failed: why }];
      }
    }),
  );
  const map = new Map(results);
  record.steps.push({ round, ms: performance.now() - started, cost: [...map.values()].reduce((n, r) => n + (r.cost || 0), 0), results: map });
  return map;
}

const answered = (map) => [...map].filter(([, r]) => !r.failed);
const named = (list) => list.map(([id, r]) => ({ name: seatById(id).name, text: r.text }));

/** Who writes the brief: a fixed seat, or everyone in turn, about every fifth decision each. */
function chooseWriter(availableIds) {
  const order = board.filter((s) => availableIds.includes(s.id));
  if (SYNTHESIZER !== "rotate" && availableIds.includes(SYNTHESIZER)) return seatById(SYNTHESIZER);
  let turn = 0;
  try {
    turn = Number(localStorage.getItem(TURN_STORE)) || 0;
    localStorage.setItem(TURN_STORE, String(turn + 1));
  } catch {}
  return order[turn % order.length];
}

async function convene() {
  const fields = {
    decision: $("decision").value,
    options: $("options").value,
    criteria: $("criteria").value,
    context: $("context").value,
  };
  const decision = decisionText(fields);
  const seats = board.filter((s) => seated.has(s.id));
  usageAtStart = checkKey(currentKey()).then((k) => k.usage, () => null);
  record = { at: new Date(), fields, docs: docs.map((d) => ({ name: d.name, kind: d.kind, size: sizeOf(d) })), seats, steps: [], brief: null, web: $("web").checked };
  controller = new AbortController();
  spent = 0;
  addCost(0);
  const t0 = performance.now();

  $("run").hidden = false;
  $("brief").hidden = true;
  $("round-debate").hidden = true;
  $("round-more").hidden = true;
  for (const id of ["cards-blind", "cards-debate", "cards-more"]) $(id).innerHTML = "";
  $("stop").hidden = false;
  $("again").hidden = true;
  $("run-note").textContent = "";
  for (const s of ["blind", "debate", "brief"]) setStep(s, "");
  $("go").disabled = true;
  $("run").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });

  try {
    // 1. Independent: each advisor alone, unaware of the others.
    setStep("blind", "active");
    const blind = await step("Independent", "cards-blind", seats, (s) => {
      const d = docsFor(s.model, decision, 0);
      return { messages: blindMessages({ model: s.model, documents: d.text, decision }), excerpt: d.excerpt };
    });
    setStep("blind", "done");
    if (controller.signal.aborted) return finish("Stopped.");
    const blindDone = answered(blind);
    if (blindDone.length < 2) return finish("Fewer than two advisors answered, so there's no board to talk it through. Check your key and credits, then try again.");

    // 2. The conversation: everyone reads everyone, with the quote check's flags.
    const blindAnswers = named(blindDone);
    const blindFlags = flagList(blindDone.map(([id, r]) => [seatById(id).name, r.checks]));
    let answersTokens = tokensOf(blindAnswers.reduce((n, a) => n + a.text.length, 0));
    $("round-debate").hidden = false;
    setStep("debate", "active");
    let debate = await step("Conversation", "cards-debate", blindDone.map(([id]) => seatById(id)), (s) => {
      const d = docsFor(s.model, decision, answersTokens);
      return { messages: discussionMessages({ model: s.model, documents: d.text, decision, self: s.name, answers: blindAnswers, quoteFlags: blindFlags }), excerpt: d.excerpt };
    });
    setStep("debate", "done");
    if (controller.signal.aborted) return finish("Stopped.");

    // 3. The brief, by this decision's writer. It may ask once for another exchange.
    let latest = answered(debate).length ? answered(debate) : blindDone;
    const writer = chooseWriter(latest.map(([id]) => id));
    const allFlags = () => record.steps.flatMap((st) => answered(st.results).map(([id, r]) => [seatById(id).name, r.checks]));
    const conversation = () => record.steps.slice(1).flatMap((st) => named(answered(st.results)));
    setStep("brief", "active");
    let brief = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      answersTokens = tokensOf([...blindAnswers, ...conversation()].reduce((n, a) => n + a.text.length, 0));
      const d = docsFor(writer.model, decision, answersTokens);
      const b0 = performance.now();
      const r = await ask({
        key: currentKey(),
        model: writer.model,
        messages: synthesisMessages({ model: writer.model, documents: d.text, decision, blind: blindAnswers, discussion: conversation(), quoteFlags: flagList(allFlags()), mayAskForMore: attempt === 0 }),
        web: false,
        signal: controller.signal,
      });
      addCost(r.cost);
      r.ms = performance.now() - b0;
      record.steps.push({ round: attempt === 0 ? "Brief" : "Brief, after another round", ms: r.ms, cost: r.cost, results: new Map() });
      if (attempt === 0 && r.text.startsWith(ANOTHER_ROUND)) {
        // The writer isn't ready: one more exchange, then the brief.
        const why = r.text.slice(ANOTHER_ROUND.length).trim();
        $("more-why").textContent = why;
        $("round-more").hidden = false;
        const latestAnswers = named(latest);
        debate = await step("Conversation, continued", "cards-more", latest.map(([id]) => seatById(id)), (s) => {
          const dd = docsFor(s.model, decision, answersTokens);
          return {
            messages: discussionMessages({ model: s.model, documents: dd.text, decision: `${decision}\n\nWhat the board must resolve: ${why}`, self: s.name, answers: latestAnswers, quoteFlags: "", round: 2 }),
            excerpt: dd.excerpt,
          };
        });
        if (controller.signal.aborted) return finish("Stopped.");
        if (answered(debate).length) latest = answered(debate);
        continue;
      }
      r.checks = checkCitations(r.text, docs);
      r.writer = writer;
      r.excerpt = d.excerpt;
      brief = r;
      break;
    }
    if (!brief) return finish("The brief couldn't be written. The independent answers and conversation are below.");
    record.brief = brief;
    record.totalMs = performance.now() - t0;
    // Parting thoughts: each advisor's last word, except the writer's.
    record.parting = latest
      .filter(([id]) => id !== writer.id)
      .map(([id, r]) => ({ seat: seatById(id), text: partingThought(r.text) }))
      .filter((p) => p.text);
    showBrief();
    setStep("brief", "done");
    finish();
  } catch (err) {
    if (err instanceof SeatError) return finish(`The brief couldn't be written: ${err.message} The answers so far are below.`);
    console.error(err);
    finish("Something went wrong. The answers so far are below.");
  }
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function partingHtml() {
  if (!record.parting.length) return "";
  return `<aside class="parting"><p class="parting-head">Parting thoughts from inside the room</p><ol>${record.parting
    .map((p) => `<li data-seat-color="${p.seat.id}"><span class="parting-who">${escape(p.seat.name)}</span> ${render(p.text, checkCitations(p.text, docs)).replace(/^<p>|<\/p>$/g, "")}</li>`)
    .join("")}</ol></aside>`;
}

function showBrief() {
  const r = record.brief;
  const all = record.steps.flatMap((st) => answered(st.results).flatMap(([, x]) => x.checks)).concat(r.checks);
  const s = checkSummary(all);
  const first = record.steps[0].results;
  const missing = [...first].filter(([, x]) => x.failed).map(([id]) => seatById(id).name);
  $("checks").innerHTML = [
    `Written by ${escape(r.writer.name)}.`,
    s.total ? `<strong>${s.total} document quotes checked:</strong> ${s.ok} found${s.moved ? `, ${s.moved} on a different page` : ""}${s.bad ? `, <strong>${s.bad} not found</strong>` : ""}.` : docs.length ? "No document quotes were cited." : "",
    missing.length ? `Missing: ${escape(missing.join(", "))}.` : "",
    r.excerpt || [...first.values()].some((x) => x.excerpt) ? "Some advisors read excerpts of the documents." : "",
    `Took ${seconds(record.totalMs)} and cost about $${spent.toFixed(2)}, as the models reported.`,
    `<button type="button" class="linkish" id="exact">Check the exact charge on my key</button> <span id="exact-out"></span>`,
  ]
    .filter(Boolean)
    .join(" ");
  $("brief-body").innerHTML = render(r.text, r.checks) + partingHtml();
  paintSeats($("brief-body"));
  $("brief").hidden = false;
  $("brief").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

// The exact charge: what the key has spent since this decision began, straight from OpenRouter.
$("checks").addEventListener("click", async (e) => {
  if (!e.target.closest("#exact")) return;
  const out = $("exact-out");
  out.textContent = "Asking OpenRouter…";
  const [before, now] = await Promise.all([usageAtStart, checkKey(currentKey()).then((k) => k.usage, () => null)]);
  out.textContent =
    before == null || now == null
      ? "OpenRouter didn't say. Your activity page at openrouter.ai has the full record."
      : `Charged to your key since this decision began: $${Math.max(0, now - before).toFixed(4)}. OpenRouter can take a minute to record the last requests, and anything else using this key counts too.`;
});

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
  const unknown = board.filter((s) => seated.has(s.id) && catalog && !catalog[s.model]);
  if (unknown.length) return ($("form-error").textContent = `${unknown.map((s) => s.name).join(", ")} isn't available on OpenRouter right now. Unseat ${unknown.length === 1 ? "it" : "them"} to continue.`);
  convene();
});

$("stop").addEventListener("click", () => controller?.abort());
$("again").addEventListener("click", () => {
  $("run").hidden = true;
  $("form-error").textContent = "";
  $("decision").focus();
  scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
});

// --- Exports: the report, as PDF (default) or Markdown ---------------------------------------
//
// In this order: the prompt, the synthesis, the parting thoughts, then the complete conversation, unedited.

const stamp = () => record.at.toISOString().slice(0, 10);
const longDate = () => record.at.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function promptHtml() {
  const f = record.fields;
  const extra = [
    ["Options", f.options],
    ["What matters most", f.criteria],
    ["Context", f.context],
  ].filter(([, v]) => v.trim());
  return `<section class="r-prompt"><p class="r-date">${escape(longDate())}</p><h1>${escape(f.decision.trim())}</h1>${extra
    .map(([k, v]) => `<p><span class="r-label">${k}.</span> ${escape(v.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("")}${record.docs.length ? `<p><span class="r-label">Documents.</span> ${record.docs.map((d) => escape(`${d.name} (${d.size})`)).join("; ")}</p>` : ""}</section>`;
}

function sourcesHtml(r) {
  return r.sources?.length ? `<p class="r-sources">${r.sources.map((s, i) => `<a href="${escape(s.url)}">[${i + 1}] ${escape(s.title)}</a>`).join(" ")}</p>` : "";
}

function buildReport() {
  const r = record.brief;
  const rounds = record.steps
    .filter((st) => st.results.size)
    .map(
      (st, i) => `<section class="r-round"><h2>${i === 0 ? "Round 1 · Independent" : `Round ${i + 1} · ${escape(st.round)}`}</h2>${[...st.results]
        .map(([id, x]) => {
          const seat = seatById(id);
          return `<article class="r-entry" data-seat-color="${seat.id}"><h3>${escape(seat.name)} <span>${escape(seat.maker)}</span></h3>${x.failed ? `<p class="r-failed">Didn't answer: ${escape(x.failed)}</p>` : render(x.text, x.checks) + sourcesHtml(x)}</article>`;
        })
        .join("")}</section>`,
    )
    .join("");
  $("report").innerHTML = `${promptHtml()}<section class="r-synthesis"><p class="r-kicker">The synthesis · written by ${escape(r.writer.name)}</p>${render(r.text, r.checks)}</section>${partingHtml()}<section class="r-transcript"><p class="r-kicker">The complete conversation</p>${rounds}</section><p class="r-meta">${escape(
    `${BRAND.name} · ${longDate()} · Board: ${record.seats.map((s) => `${s.name} (${s.model})`).join(", ")} · Web search ${record.web ? "on" : "off"} · ${seconds(record.totalMs)} · $${spent.toFixed(2)}`,
  )}</p>`;
}

/** Seat colours, set through the DOM because the security policy blocks inline style attributes. */
function paintSeats(root) {
  for (const el of root.querySelectorAll("[data-seat-color]")) el.style.setProperty("--seat", seatById(el.dataset.seatColor).color);
}

$("print").addEventListener("click", () => {
  buildReport();
  paintSeats($("report"));
  document.body.classList.add("print-report");
  window.print();
});
addEventListener("afterprint", () => document.body.classList.remove("print-report"));

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const checkNote = (checks) =>
  checks
    .filter((c) => c.status !== "verified")
    .map((c) => `- "${c.quote}" (${c.file}, ${c.label}): ${c.status === "elsewhere" ? `found on ${c.foundAt}` : "NOT found in the documents"}`)
    .join("\n");

$("dl-md").addEventListener("click", () => {
  const f = record.fields;
  const prompt = [
    `# ${f.decision.trim()}`,
    `_${longDate()}_`,
    f.options.trim() && `**Options.** ${f.options.trim()}`,
    f.criteria.trim() && `**What matters most.** ${f.criteria.trim()}`,
    f.context.trim() && `**Context.** ${f.context.trim()}`,
    record.docs.length ? `**Documents.** ${record.docs.map((d) => `${d.name} (${d.size})`).join("; ")}` : "",
  ].filter(Boolean);
  const parting = record.parting.length ? `## Parting thoughts from inside the room\n\n${record.parting.map((p) => `- **${p.seat.name}:** ${p.text}`).join("\n")}` : "";
  const rounds = record.steps
    .filter((st) => st.results.size)
    .map(
      (st, i) =>
        `## ${i === 0 ? "Round 1: Independent" : `Round ${i + 1}: ${st.round}`}\n\n` +
        [...st.results]
          .map(([id, x]) => {
            const s = seatById(id);
            if (x.failed) return `### ${s.name} (${s.maker})\n\nDidn't answer: ${x.failed}`;
            const flagged = checkNote(x.checks);
            const src = x.sources?.length ? `\n\nSources:\n${x.sources.map((y) => `- [${y.title}](${y.url})`).join("\n")}` : "";
            return `### ${s.name} (${s.maker})\n\n${x.text}${src}${flagged ? `\n\nQuote check:\n${flagged}` : ""}`;
          })
          .join("\n\n"),
    )
    .join("\n\n");
  const meta = `${BRAND.name} · Board: ${record.seats.map((s) => `${s.name} (${s.model})`).join(", ")} · Web search ${record.web ? "on" : "off"} · ${seconds(record.totalMs)} · $${spent.toFixed(2)} · brief by ${record.brief.writer.name}`;
  download(`${BRAND.name} ${stamp()}.md`, [prompt.join("\n\n"), record.brief.text, parting, `# The complete conversation\n\n${rounds}`, `---\n${meta}`].filter(Boolean).join("\n\n---\n\n") + "\n");
});

// --- Start ---------------------------------------------------------------------------------

showKey();
$("web").checked = WEB_SEARCH_DEFAULT;
renderSeats();
estimate();
modelCatalog()
  .then((c) => {
    catalog = c;
    estimate();
    if ($("add").open) renderAdd();
  })
  .catch(() => {
    $("add-list").innerHTML = `<li class="muted small">Couldn't load OpenRouter's model list. The board's own advisors still work.</li>`;
  });
