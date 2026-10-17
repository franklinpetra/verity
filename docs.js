// Reads uploaded documents in the browser: PDF, Word, Excel, PowerPoint and plain text. Nothing is uploaded.
// Each document becomes a list of labelled units ("p. 12", "slide 3", "sheet Revenue", "part 4") so the
// board can cite exactly where a claim comes from, and so quotes can be checked against the source.

import { LIMITS } from "./config.js";

const PART_CHARS = 3000; // Word and text files have no pages, so they're split into parts about this long.
const SCANNED_BELOW = 25; // A PDF page with fewer readable characters than this is probably a scan.

const scripts = new Map();
/** Loads one of our bundled libraries (they're served from this site, never a third party). */
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Couldn't load ${src}`));
        document.head.append(s);
      }),
    );
  }
  return scripts.get(src);
}

const tidy = (s) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Splits running text into parts of about PART_CHARS, breaking between paragraphs. */
function intoParts(text) {
  const units = [];
  let current = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (current && current.length + para.length > PART_CHARS) {
      units.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) units.push(current);
  return units.map((t, i) => ({ label: `part ${i + 1}`, text: tidy(t) }));
}

async function readPdf(buffer) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const units = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("");
    units.push({ label: `p. ${n}`, text: tidy(text) });
  }
  return units;
}

async function readDocx(buffer) {
  await loadScript("vendor/mammoth.browser.min.js");
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return intoParts(value);
}

async function readXlsx(buffer) {
  await loadScript("vendor/xlsx.full.min.js");
  const book = window.XLSX.read(buffer, { type: "array" });
  return book.SheetNames.map((name) => ({ label: `sheet ${name}`, text: tidy(window.XLSX.utils.sheet_to_csv(book.Sheets[name])) }));
}

async function readPptx(buffer) {
  await loadScript("vendor/jszip.min.js");
  const zip = await window.JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((path) => path.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .sort((a, b) => a[1] - b[1]);
  const units = [];
  for (const [path, n] of slides) {
    const xml = await zip.file(path).async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const paragraphs = [...doc.getElementsByTagNameNS("*", "p")].map((p) =>
      [...p.getElementsByTagNameNS("*", "t")].map((t) => t.textContent).join(""),
    );
    units.push({ label: `slide ${n}`, text: tidy(paragraphs.filter(Boolean).join("\n")) });
  }
  return units;
}

const READERS = [
  { test: /\.pdf$/i, kind: "PDF", read: readPdf },
  { test: /\.docx$/i, kind: "Word", read: readDocx },
  { test: /\.(xlsx|xlsm|xls)$/i, kind: "Excel", read: readXlsx },
  { test: /\.pptx$/i, kind: "PowerPoint", read: readPptx },
  { test: /\.(txt|md|markdown|csv|tsv|json|html?)$/i, kind: "Text", read: async (buffer) => intoParts(new TextDecoder().decode(buffer)) },
];

export const ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.xls,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.htm,.html";

/**
 * Reads one file into { name, kind, units: [{ label, text }], chars, scannedPages }.
 * Throws a plain-language Error for files we can't read.
 */
export async function readDocument(file) {
  const reader = READERS.find((r) => r.test.test(file.name));
  if (!reader) throw new Error(`${file.name}: this kind of file isn't supported yet. Try PDF, Word, Excel, PowerPoint or text.`);
  if (file.size > LIMITS.maxFileMB * 1024 * 1024) throw new Error(`${file.name} is over ${LIMITS.maxFileMB} MB. Try splitting it.`);
  let units;
  try {
    units = await reader.read(await file.arrayBuffer());
  } catch (err) {
    console.error(err);
    const locked = /password/i.test(err?.message || "");
    throw new Error(locked ? `${file.name} is password-protected. Remove the password and try again.` : `${file.name} couldn't be read. It may be damaged.`);
  }
  const scannedPages = reader.kind === "PDF" ? units.filter((u) => u.text.length < SCANNED_BELOW).map((u) => u.label) : [];
  units = units.filter((u) => u.text.length);
  const chars = units.reduce((n, u) => n + u.text.length, 0);
  if (!chars) throw new Error(`${file.name} has no readable text. If it's a scan, it needs OCR first.`);
  return { name: file.name, kind: reader.kind, units, chars, scannedPages };
}

/** Roughly how many tokens some text is: about four characters each in English. */
export const tokensOf = (chars) => Math.ceil(chars / 4);

/** The documents as one block of text with clear labels, ready to give a model. */
export function documentsText(docs, onlyUnits = null) {
  return docs
    .map((doc, d) => {
      const units = onlyUnits ? doc.units.filter((_, u) => onlyUnits.has(`${d}:${u}`)) : doc.units;
      const body = units.map((u) => `[${u.label}]\n${u.text}`).join("\n\n");
      const note = onlyUnits && units.length < doc.units.length ? ` (excerpts: ${units.length} of ${doc.units.length} sections)` : "";
      return `<document name="${doc.name.replace(/"/g, "'")}"${note}>\n${body}\n</document>`;
    })
    .join("\n\n");
}

/**
 * When the documents are too long for a model, picks the sections most relevant to the decision.
 * A simple, transparent word-overlap score: every chosen section is listed, nothing is summarised away.
 */
export function pickRelevant(docs, decisionText, budgetChars) {
  const words = (s) => s.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
  const STOP = new Set("the and for that with this from have are was were will would should could their there which what when where about into than then them they your our has had not but also its his her any all can may".split(" "));
  const terms = new Map();
  for (const w of words(decisionText)) if (!STOP.has(w)) terms.set(w, (terms.get(w) || 0) + 1);
  const scored = [];
  docs.forEach((doc, d) =>
    doc.units.forEach((unit, u) => {
      const text = unit.text.toLowerCase();
      let score = 0;
      for (const [term, weight] of terms) if (text.includes(term)) score += weight;
      // First sections (summaries, cover pages) usually matter, so they get a small head start.
      if (u < 2) score += 2;
      scored.push({ key: `${d}:${u}`, score, size: unit.text.length + 20 });
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  const chosen = new Set();
  let used = 0;
  for (const s of scored) {
    if (used + s.size > budgetChars) continue;
    chosen.add(s.key);
    used += s.size;
  }
  return chosen;
}
