// The OpenRouter adapter: straight from the browser with the person's own key. One request format and one
// bill for every seat, provider routing that keeps data private, and a web-search plugin for sources.

import { BRAND, LIMITS } from "../config.js";
import { SeatError } from "../errors.js";

const API = "https://openrouter.ai/api/v1";

function explain(status, body) {
  const detail = body?.error?.message || "";
  if (status === 401) return "OpenRouter didn't accept the key.";
  if (status === 402) return "The OpenRouter account is out of credits.";
  if (status === 429) return "This model is busy right now (rate limited).";
  if (status === 403 && /moderat/i.test(detail)) return "The model's provider declined this request.";
  if (status === 404 || /no endpoints|not a valid model/i.test(detail)) return "This model isn't available from a provider that keeps data private.";
  if (/context|too long|maximum.*tokens/i.test(detail)) return "The documents are too long for this model.";
  return detail ? `OpenRouter: ${detail.slice(0, 160)}` : `OpenRouter answered ${status}.`;
}

/**
 * One model call. Returns { text, sources: [{ url, title }], cost }.
 * A reply cut off at the length limit is a failure, never a short answer: half a thought is worse than none,
 * because the rest of the board would argue with it.
 */
export async function ask({ key, model, messages, web = false, signal }) {
  const timeout = AbortSignal.timeout(LIMITS.timeoutMs);
  let res;
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": BRAND.name,
        "HTTP-Referer": location.origin,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: LIMITS.replyTokens,
        reasoning: { effort: "medium" },
        // Only providers that don't store or train on what they're sent.
        provider: { data_collection: "deny" },
        usage: { include: true },
        ...(web ? { plugins: [{ id: "web", max_results: LIMITS.webResults }] } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw new SeatError("Stopped.");
    if (timeout.aborted) throw new SeatError("Took too long to answer.");
    throw new SeatError("Couldn't reach OpenRouter. Check the connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new SeatError(explain(res.status || data.error?.code, data));
  const choice = data.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
  if (choice?.finish_reason === "length" || choice?.native_finish_reason === "max_tokens") throw new SeatError("The answer was cut off before it finished.");
  if (!text) throw new SeatError("The model returned an empty answer.");
  const sources = (choice.message.annotations || [])
    .filter((a) => a.type === "url_citation" && a.url_citation?.url)
    .map((a) => ({ url: a.url_citation.url, title: a.url_citation.title || a.url_citation.url }));
  return { text, sources, cost: Number(data.usage?.cost) || 0 };
}

/** OpenRouter's public model list: { id: { name, maker, writes, context, inPrice, outPrice, cachePrice } }, prices per token. */
export async function modelCatalog() {
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error("Couldn't load OpenRouter's model list.");
  const out = {};
  for (const m of (await res.json()).data || []) {
    const full = m.name || m.id;
    const colon = full.indexOf(": ");
    out[m.id] = {
      name: colon > 0 ? full.slice(colon + 2) : full,
      maker: colon > 0 ? full.slice(0, colon) : m.id.split("/")[0],
      // Only models that answer in text can sit on the board.
      writes: !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"),
      context: m.context_length || 0,
      inPrice: Number(m.pricing?.prompt) || 0,
      outPrice: Number(m.pricing?.completion) || 0,
      cachePrice: Number(m.pricing?.input_cache_read) || 0,
    };
  }
  return out;
}

/** Checks a key and returns what's left on it and what it has spent so far, or throws a plain-language error. */
export async function checkKey(key) {
  const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) throw new Error("OpenRouter didn't accept that key.");
  if (!res.ok) throw new Error("Couldn't check the key right now.");
  const { data } = await res.json();
  return { label: data?.label || "", remaining: data?.limit_remaining ?? null, usage: typeof data?.usage === "number" ? data.usage : null };
}
