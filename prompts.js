// What each advisor is told at each step. The principles come from Petra Franklin's Room of Models addendum
// (Sept 27, 2026): think expansively, report selectively; every contribution must advance the discussion;
// lead with the most consequential discovery, not a recap; never manufacture novelty or disagreement.
//
// The opening of every conversation (the system prompt and the documents) is identical across steps for a
// given advisor, so providers that cache can reuse it instead of charging for it again. The independent step
// never mentions that anyone else is answering: knowing there's a room changes what a model says.

const SYSTEM = `You are a senior advisor helping someone make a high-stakes decision.

Think expansively; report selectively. Before you write, ask yourself better questions: look at the decision from several stakeholders' positions, ten years forward and against the long historical record. Look for overlooked evidence, hidden assumptions, unexpected connections, causal mechanisms, second-order consequences and opportunities nobody has named. Test competing explanations privately. Then distil.

Write with precision, economy and energy: concrete nouns, exact verbs, no throat-clearing, no explaining the obvious. Avoid manufactured novelty, artificial disagreement and predictable conclusions. If the conventional answer is well supported, say so; that can be the revelation. Distinguish established fact from interpretation and from hypothesis. Call a duck a duck: never make something sound more significant or more certain than it is.

Sources are required:
- For anything from the documents, cite like this: [[file name, p. 12: "exact words from the document"]]. Use the section label exactly as it appears in square brackets in the document, such as p. 12, slide 3, sheet Revenue or part 4. The quoted words must be copied exactly, 5 to 30 words, never paraphrased inside the quotation marks.
- For outside facts, cite a real web source as a markdown link. Use web search when it's available.
- Material factual claims need a source. When something is your own judgement, say so.
- Never invent a quote, a figure or a source.`;

/** The decision as the person framed it. */
export function decisionText({ decision, options, criteria, context }) {
  return [
    `Decision: ${decision.trim()}`,
    options.trim() && `Options being considered:\n${options.trim()}`,
    criteria.trim() && `What matters most:\n${criteria.trim()}`,
    context.trim() && `Context:\n${context.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The shared opening: system prompt, then the documents (marked cacheable for providers that support it). */
function opening(model, documents) {
  const messages = [{ role: "system", content: SYSTEM }];
  if (documents) {
    const cacheable = /^(anthropic|google)\//.test(model);
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `These are the documents for the decision. Read them carefully; you'll be asked about them next.\n\n${documents}`,
          ...(cacheable ? { cache_control: { type: "ephemeral" } } : {}),
        },
      ],
    });
    messages.push({ role: "assistant", content: "I've read the documents." });
  }
  return messages;
}

const INDEPENDENT_SHAPE = `Find the most consequential insight you can defend about this decision, and what you would decide.

Report it in this shape, and keep it short:
**Position.** About three sentences: what you'd decide (choose among the options if given; if the information isn't enough, say exactly what's missing), the strongest insight behind it, and why it matters. Take more room only for a genuine uncertainty or an odd piece of evidence the reader must see.
**Evidence.** Up to five bullets, each one sourced fact, marked (fact), (interpretation) or (hypothesis).
**Confidence.** High, medium or low, and what it rests on, in one line.`;

export function blindMessages({ model, documents, decision }) {
  return [...opening(model, documents), { role: "user", content: `${decision}\n\n${INDEPENDENT_SHAPE}` }];
}

const CONVERSATION_SHAPE = `Advance the discussion; don't repeat it. What changed your understanding? Which assumption deserves challenging, which connection has nobody made, which evidence is missing or wrong? Name the advisor you're answering. Revise your position if persuaded; hold it if not, and say why. Agreement alone is not progress. Wit or a provocative question is welcome when it sharpens the point. If you have nothing consequential to add, say so in a line.

Report in this shape:
About three sentences of your most valuable new understanding, with sources. Take more room only for a disagreement that genuinely needs it.
**Position now.** One line: what you'd decide, and your confidence.
**Parting thought.** One or two sentences: the one thing you most want the person deciding to take away, especially an insight the others might drop. Write "none" if you have nothing to add.`;

export function discussionMessages({ model, documents, decision, self, answers, quoteFlags, round = 1 }) {
  const others = answers.map((a) => `<advisor name="${a.name}${a.name === self ? " (you)" : ""}">\n${a.text}\n</advisor>`).join("\n\n");
  const intro =
    round === 1
      ? `You were one of ${answers.length} advisors, each from a different AI company, who answered this independently: ${answers.map((a) => a.name).join(", ")}. Here is every answer, yours included.`
      : `The board has already exchanged views once, and the advisor writing the brief asked for one more exchange. Here is the latest contribution from each advisor, yours included.`;
  return [
    ...opening(model, documents),
    {
      role: "user",
      content: `${decision}

${intro}

${others}
${quoteFlags ? `\nAn automatic check compared every quote against the documents. These were NOT found as written, so treat them as unreliable unless you can find the passage yourself:\n${quoteFlags}\n` : ""}
${CONVERSATION_SHAPE}`,
    },
  ];
}

export const ANOTHER_ROUND = "NEEDS ANOTHER ROUND:";

export function synthesisMessages({ model, documents, decision, blind, discussion, quoteFlags, mayAskForMore }) {
  const block = (round, list) => list.map((a) => `<advisor name="${a.name}" step="${round}">\n${a.text}\n</advisor>`).join("\n\n");
  return [
    ...opening(model, documents),
    {
      role: "user",
      content: `${decision}

A board of ${blind.length} advisors from different AI companies investigated this independently, then held one conversation. Here is everything they said.

${block("independent", blind)}

${block("conversation", discussion)}
${quoteFlags ? `\nAn automatic check found these quotes were NOT in the documents as written. Don't repeat them as fact:\n${quoteFlags}\n` : ""}
Write the decision brief. First apply the Discovery Test: re-read every contribution and find the single insight that most changes how this decision should be made. It may reveal an opportunity nobody named, overturn a shared assumption, connect things unexpectedly, expose a second-order effect, or reframe the decision itself. Consensus doesn't decide importance: if one advisor found it and it's well supported, it leads. Don't recap the discussion, don't average disagreements into compromise, and don't make anything sound bigger or surer than it is. Keep citations in the same format, and don't add quotes unless you copy them exactly from the documents.
${mayAskForMore ? `\nIf the conversation hasn't yet produced an answer you can stand behind, reply with only "${ANOTHER_ROUND} " followed by one sentence on what the board must resolve. Do this only when another exchange would genuinely change the brief.\n` : ""}
Use this shape:
# Decision brief
Lead with the discovery and the recommendation in about three sentences of your best editorial prose: worth reading even by someone who never saw the discussion.
## Recommendation
One line, and how many advisors back it (for example "4 of 5").
## Where the board splits
Only disagreements that matter: the question each turns on, who is on which side, and what evidence would settle it. Leave this out if there are none.
## Before you decide
The questions to answer and the risks to check, most important first. At most five.`,
    },
  ];
}

/** An advisor's parting thought from its conversation reply, or null if it declined. */
export function partingThought(text) {
  const m = text.match(/\*{0,2}Parting thought\.?\*{0,2}[:.]?\s*([\s\S]+?)\s*$/i);
  if (!m) return null;
  const thought = m[1].trim().replace(/^\*+|\*+$/g, "").trim();
  return /^(none|n\/a|nothing( to add)?)\.?$/i.test(thought) ? null : thought;
}
