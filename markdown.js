// A small, safe Markdown renderer for the advisors' answers: headings, bold, italics, lists, links,
// paragraphs and our document citations. Everything is escaped first, so model output can never inject HTML.

import { CITATION } from "./verify.js";

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MARK = { verified: "✓", elsewhere: "≈", "not-found": "✗", "unknown-file": "✗" };
const TITLE = {
  verified: "Quote found on the cited page",
  elsewhere: "Quote found, but on a different page",
  "not-found": "Quote NOT found in the document",
  "unknown-file": "No uploaded document by that name",
};

function inline(text, checks) {
  let i = 0;
  // Citations first, while the text is still raw, then escape the rest around them.
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(CITATION.source, "gi"))) {
    parts.push(escapeInline(text.slice(last, m.index)));
    const c = checks?.[i++];
    const status = c?.status || "not-found";
    const where = c?.status === "elsewhere" ? ` (actually ${c.foundAt})` : "";
    parts.push(
      `<span class="cite ${status}" title="${escape(TITLE[status] + where)}"><span class="cite-mark" aria-hidden="true">${MARK[status]}</span><span class="sr-only">${escape(TITLE[status])}: </span>“${escape(m[3].trim())}” <span class="cite-where">${escape(m[1].trim())}, ${escape(m[2].trim())}${escape(where)}</span></span>`,
    );
    last = m.index + m[0].length;
  }
  parts.push(escapeInline(text.slice(last)));
  return parts.join("");
}

function escapeInline(s) {
  return escape(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

/** Markdown → safe HTML. `checks` are this text's citation checks, in order. */
export function render(md, checks = []) {
  // Count citations per line so each line's inline() gets its own slice of the checks.
  let next = 0;
  const take = (line) => {
    const n = [...line.matchAll(new RegExp(CITATION.source, "gi"))].length;
    const slice = checks.slice(next, next + n);
    next += n;
    return inline(line, slice);
  };
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(take).join("<br />")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${take(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) {
        flushList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${take((bullet || numbered)[1])}</li>`);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}
