# Verity

**A board of AI advisors for decisions that matter.**

Describe a decision and drop in the documents behind it: a diligence memo, a contract, a board deck, a financial model. Up to six advisors from different AI companies (by default Claude, GPT, Gemini, Grok and Muse, or any you add from OpenRouter) read them, answer on their own, debate each other once, and hand you a decision brief. Every quote an advisor attributes to your documents is checked against the documents themselves.

It runs entirely in your browser, on your own OpenRouter key. There is no server.

## How a decision runs

1. **Independent answers.** Each advisor reads the documents and answers alone, unaware that anyone else is answering. Knowing there's a room makes models posture, defer or leave gaps, so the room is only introduced in step 2.
2. **Quote check.** Every citation like `[[memo.pdf, p. 12: "exact words"]]` is looked up in the document text. It's marked found on the cited page (✓), found on a different page (≈), or not found (✗). The check is mechanical, not another model's opinion.
3. **Debate.** Each advisor reads every answer, plus the list of quotes that weren't found, and must say where the others are wrong, with evidence. Changing position without a new argument gets called out.
4. **Decision brief.** One advisor (Claude by default) writes the brief:
   - the recommendation and how many advisors back it
   - where the board agrees, and where it splits and why
   - the risks, and what would change the answer
   - the questions to answer before deciding

   Disagreement is kept, not averaged away.

You can download the brief, download the full record (every answer, the debate and the quote checks), or print either to PDF.

## Rules the code enforces

- **A cut-off answer is a failure,** never a short answer. Half a thought is worse than none, because the board would argue with it.
- **A failure never reads as a success.** If an advisor is rate-limited, times out or is cut off, the run names it and carries on with the rest. At least two advisors are needed to debate.
- **Only private providers.** Every request asks OpenRouter for providers that don't store or train on data. Meta's "contributor" tier, which trains on prompts, isn't used.
- **Nothing leaves the tab except the model calls.** The Content-Security-Policy (in `index.html` and `vercel.json`) allows connections to `openrouter.ai` and nothing else. That rules out analytics, web fonts and third-party scripts; the document libraries are served from `vendor/`.

## Documents

- **Formats:** PDF, Word (.docx), Excel, PowerPoint (.pptx) and text are read in the browser by `docs.js`, keeping page, slide and sheet labels so they can be cited.
- **Scanned PDFs:** pages with no readable text are flagged. OCR isn't built in yet.
- **Long documents:** a document is read whole when it fits in a model's memory (about 1,000+ pages for most seats). When it doesn't, that advisor gets the sections most relevant to the decision, and the page says so.
- **Cost estimate:** shown before you run, based on OpenRouter's live prices. A typical 100-page decision costs a few dollars on your key.

**Web search is off by default.** Turned on, each advisor can search for outside facts such as market data and comparable deals. That adds a few cents and sends search queries to OpenRouter's search provider, so leave it off for confidential matters.

## Files

| File | What it does |
|---|---|
| `config.js` | Name, board seats and models, who writes the brief, limits: everything a branded version changes |
| `index.html`, `styles.css` | The page and its look (colours are tokens at the top of `styles.css`) |
| `app.js` | The flow: documents, key, estimate, the three steps, exports |
| `docs.js` | Reads PDF, Word, Excel, PowerPoint and text; picks relevant sections when documents are too long |
| `prompts.js` | What each advisor is told at each step |
| `llm.js` | The one door to the models: picks the adapter set in `config.js` and documents the contract every adapter follows |
| `providers/openrouter.js` | Today's adapter: OpenRouter calls, failures, web search and the live model list. Direct-to-provider or backend adapters go beside it |
| `verify.js` | The quote check |
| `markdown.js` | Safe rendering of answers, with quote-check marks |
| `vendor/` | pdf.js (Apache-2.0), mammoth (BSD-2), JSZip (MIT), SheetJS (Apache-2.0) |

## Running it

No build step. Serve the folder with any static server, for example `python3 -m http.server`, then open it and add an OpenRouter key from [openrouter.ai/keys](https://openrouter.ai/keys). Give the key a spending limit.

Built by Tandem Works.
