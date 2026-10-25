// Everything a branded or re-tuned version changes, in one place. Colours live at the top of styles.css.

export const BRAND = {
  name: "Verity",
  tagline: "A board of AI advisors for decisions that matter.",
  // The maker's mark; a white-label version sets this to null.
  maker: { name: "Tandem Works", logo: "icons/tandem-works.png" },
  // Who made it and where ideas and problems go; a white-label version sets this to null.
  feedback: { name: "Petra Franklin", email: "petrafranklin@gmail.com" },
};

// The board. Each seat is a model from a different company, so their mistakes don't line up.
// Ids are OpenRouter model ids; the page checks them against OpenRouter's live list before a run.
export const SEATS = [
  { id: "claude", name: "Claude", maker: "Anthropic", model: "anthropic/claude-opus-5.5", color: "#a35b2a" },
  { id: "gpt", name: "GPT", maker: "OpenAI", model: "openai/gpt-6.1-sol", color: "#2f6b5e" },
  { id: "gemini", name: "Gemini", maker: "Google", model: "google/gemini-4-argon", color: "#3f5fa8" },
  { id: "grok", name: "Grok", maker: "xAI", model: "x-ai/grok-4.7", color: "#8a3b5c" },
  // Not the "contributor" tier, which trains on what it's sent.
  { id: "muse", name: "Muse", maker: "Meta", model: "meta/muse-spark-1.3", color: "#6b4aa8" },
];

// Seats at the table, and the colours given to advisors added from OpenRouter's list, in order.
export const MAX_SEATS = 6;
export const ADDED_COLORS = ["#2c7f8f", "#8a6d1f", "#a23c6b", "#4f5d75", "#7a4a2a", "#b03a3a"];

// Which service reaches the models. "openrouter" today; adapters live in providers/ (see llm.js).
export const PROVIDER = "openrouter";

// Who writes the decision brief: "rotate" takes turns, so each advisor writes about every fifth brief.
// Or a seat id, such as "claude", to always use one.
export const SYNTHESIZER = "rotate";

// Sources are expected in this room, so advisors may search the web unless the person turns it off.
export const WEB_SEARCH_DEFAULT = true;

export const LIMITS = {
  // Room left in each model's memory for its own thinking and answer.
  replyTokens: 24_000,
  // A model that hasn't answered in this long is marked failed and the run goes on without it.
  timeoutMs: 6 * 60_000,
  // Web results per model per step, when web search is on.
  webResults: 5,
  // Biggest single file we'll read.
  maxFileMB: 60,
};
