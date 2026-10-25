// The one door to the models. The rest of Verity calls ask(), modelCatalog() and checkKey() from here and
// never knows which service is behind them, so changing services is a setting, not a rewrite.
//
// Every adapter in providers/ exports the same three functions:
//   ask({ key, model, messages, web, signal }) → { text, sources: [{ url, title }], cost }
//       Throws SeatError with a plain-language reason. A reply cut off at the length limit must throw,
//       never return a partial answer.
//   modelCatalog() → { [model]: { name, maker, writes, context, inPrice, outPrice, cachePrice } }, prices per token
//   checkKey(key) → { label, remaining, usage }, usage being what the key has spent so far
// Later adapters (direct to each AI company, or our own backend gateway) follow the same contract. A backend
// adapter also changes the privacy story and the Content-Security-Policy, so update both when adding one.

import { PROVIDER } from "./config.js";
import * as openrouter from "./providers/openrouter.js";

export { SeatError } from "./errors.js";

const PROVIDERS = { openrouter };
const active = PROVIDERS[PROVIDER];
if (!active) throw new Error(`Unknown model provider "${PROVIDER}" in config.js`);

export const ask = (options) => active.ask(options);
export const modelCatalog = () => active.modelCatalog();
export const checkKey = (key) => active.checkKey(key);
