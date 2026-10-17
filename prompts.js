// What each advisor is told at each step.
//
// The opening of every conversation (the system prompt and the documents) is identical across steps for a
// given advisor, so providers that cache can reuse it in later steps instead of charging for it again.
// The blind step never mentions that anyone else is answering: knowing there's a room changes what a model
// says, so the room is only introduced in the discussion step.

const SYSTEM = `You are a senior advisor helping someone make a high-stakes decision. Be direct, specific and honest about uncertainty. Disagree with conventional wisdom when the evidence supports it.

How to support what you say:
- When you rely on the documents, cite them like this: [[file name, p. 12: "exact words from the document"]]. Use the section label exactly as it appears in square brackets in the document, such as p. 12, slide 3, sheet Revenue or part 4. The quoted words must be copied exactly, 5 to 30 words, never paraphrased inside the quotation marks.
- When you use a web source, cite it as a markdown link.
- When something is your own judgement rather than something you can source, say so.
- Never invent a quote, a figure or a source. If the documents don't say, say they don't.`;

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

const ANSWER_SHAPE = `Answer in this shape:
## Recommendation
What you'd decide and why, in a short paragraph. If options were given, choose among them. If there isn't enough information to decide, say exactly what's missing.
## Confidence
High, medium or low, and the one or two things your confidence rests on.
## Reasoning
The case, with citations.
## Risks, and what would change my mind
## Questions to answer before deciding`;

export function blindMessages({ model, documents, decision }) {
  return [...opening(model, documents), { role: "user", content: `${decision}\n\n${ANSWER_SHAPE}` }];
}

export function discussionMessages({ model, documents, decision, self, answers, quoteFlags }) {
  const others = answers.map((a) => `<advisor name="${a.name}${a.name === self ? " (you)" : ""}">\n${a.text}\n</advisor>`).join("\n\n");
  return [
    ...opening(model, documents),
    {
      role: "user",
      content: `${decision}

You were one of ${answers.length} advisors, each from a different AI company, who answered this independently: ${answers.map((a) => a.name).join(", ")}. Here is every answer, yours included.

${others}
${quoteFlags ? `\nAn automatic check compared every quote against the documents. These quotes were NOT found as written, so treat them as unreliable unless you can find the passage yourself:\n${quoteFlags}\n` : ""}
Now respond to the others. Name advisors when you disagree with them, and back each point with evidence. Change your position only for a better argument or new evidence, never just to agree, and if someone else changed their mind without new evidence, say so.

Answer in this shape:
## Where I disagree
## What changed my mind, or didn't
## My position now
Recommendation and confidence, in a short paragraph.`,
    },
  ];
}

export function synthesisMessages({ model, documents, decision, blind, discussion, quoteFlags }) {
  const block = (round, list) => list.map((a) => `<advisor name="${a.name}" step="${round}">\n${a.text}\n</advisor>`).join("\n\n");
  return [
    ...opening(model, documents),
    {
      role: "user",
      content: `${decision}

A board of ${blind.length} advisors from different AI companies answered this independently, then debated once. Here is everything they said.

${block("independent answer", blind)}

${block("debate", discussion)}
${quoteFlags ? `\nAn automatic check found these quotes were NOT in the documents as written. Don't repeat them as fact:\n${quoteFlags}\n` : ""}
Write the decision brief for the person deciding. Don't average the disagreements away: where the board splits is often the most useful thing you can tell them. Keep the advisors' citations in the same format, and don't add quotes of your own unless you copy them exactly from the documents.

Use this shape:
# Decision brief
## Recommendation
The recommendation, and how many advisors back it (for example "4 of 5").
## Confidence
## Where the board agrees
## Where the board splits
For each disagreement: the question it turns on, who is on each side, the strongest argument each way, and what evidence would settle it.
## Key risks
## What would change the answer
## Before you decide
The questions to answer, most important first.`,
    },
  ];
}
