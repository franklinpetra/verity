// Checks every quote an advisor attributes to the documents against the documents themselves.
// Invented or misquoted evidence is the most dangerous failure in high-stakes work, and this check is
// mechanical: a quote either appears in the text or it doesn't. No model is asked to judge another.

// [[file name, p. 12: "exact words"]]
const CITATION = /\[\[([^\]]+?),\s*((?:p\.?|pp\.?|page|slide|sheet|part)\s*[^:\]]*?):\s*["“]([^\]]+?)["”]\s*\]\]/gi;

/** Letters and digits only, lowercased: survives PDF line breaks, hyphenation, curly quotes and spacing. */
const bare = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/-\s*\n\s*/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const labelKey = (label) => bare(label.replace(/^page\b/i, "p").replace(/^pp\.?/i, "p"));

const indexCache = new WeakMap();
function indexOf(doc) {
  if (!indexCache.has(doc)) indexCache.set(doc, doc.units.map((u) => ({ label: u.label, key: labelKey(u.label), text: bare(u.text) })));
  return indexCache.get(doc);
}

function findDoc(docs, name) {
  const want = bare(name);
  return docs.find((d) => bare(d.name) === want) || docs.find((d) => bare(d.name).includes(want) || want.includes(bare(d.name.replace(/\.[^.]+$/, ""))));
}

/** True when every piece of the quote (split at "…") appears in the text. */
const contains = (text, quote) => quote.split(/\.{3}|…/).map(bare).filter((p) => p.length >= 4).every((p) => text.includes(p));

/**
 * Every citation in some text, checked: [{ raw, file, label, quote, status, foundAt }].
 * status: "verified" (on the cited page), "elsewhere" (in the document, different place), "not-found",
 * or "unknown-file" (no uploaded document by that name).
 */
export function checkCitations(text, docs) {
  const out = [];
  for (const m of text.matchAll(CITATION)) {
    const [raw, file, label, quote] = m;
    const doc = findDoc(docs, file.trim());
    let status = "unknown-file";
    let foundAt = null;
    if (doc) {
      const units = indexOf(doc);
      const cited = units.find((u) => u.key === labelKey(label));
      if (cited && contains(cited.text, quote)) status = "verified";
      else {
        const hit = units.find((u) => contains(u.text, quote));
        status = hit ? "elsewhere" : "not-found";
        foundAt = hit?.label ?? null;
      }
    }
    out.push({ raw, file: file.trim(), label: label.trim(), quote: quote.trim(), status, foundAt });
  }
  return out;
}

/** The unreliable quotes, as a short list to show the board in the next step. */
export function flagList(byAdvisor) {
  const lines = [];
  for (const [name, checks] of byAdvisor) {
    for (const c of checks) {
      if (c.status === "verified") continue;
      const why = c.status === "elsewhere" ? `found, but on ${c.foundAt}, not ${c.label}` : c.status === "unknown-file" ? "no document by that name" : "not found anywhere";
      lines.push(`- ${name} quoted "${c.quote}" (${c.file}, ${c.label}): ${why}`);
    }
  }
  return lines.join("\n");
}

export { CITATION };
