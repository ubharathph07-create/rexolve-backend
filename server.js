app.post("/ask-doubt", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing messages" });
    }

    const lastUserMessage =
      messages[messages.length - 1].content || "";

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
You are a calm, neutral expert advisor.

Give concise, balanced recommendations for everyday decisions.
Default to short natural paragraphs of 3–4 sentences.

Guidelines:
- Start with a clear conclusion.
- Add one or two key reasons.
- Include one condition or tradeoff when relevant.
- Avoid rigid templates unless they improve clarity.
- Avoid commands and moral language.
- Prefer conditional, tradeoff-based advice over directives.
- Admit uncertainty when information is insufficient.
- Be professional, neutral, and non-judgmental.
- Preserve user agency: advise, do not decide.
- Optimize for trust, clarity, and natural expert communication.

Only provide detailed explanations if the user explicitly asks for more detail.
When explaining, be structured and balanced.
`,
        },

        // pass all user + assistant messages EXCEPT any system messages
        ...messages.filter(m => m.role !== "system"),
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    let answer = completion.choices[0].message.content;

    /* ===================== FORMAT ENFORCEMENT ===================== */

    if (wantsWordList(lastUserMessage)) {
      let words = extractWords(answer);

      const letter = extractStartingLetter(lastUserMessage);
      if (letter) {
        words = words.filter((w) =>
          w.toLowerCase().startsWith(letter)
        );
      }

      const unique = [
        ...new Set(words.map((w) => w.toLowerCase())),
      ];

      const requestedCount =
        extractRequestedCount(lastUserMessage);

      let finalWords = unique;
      if (requestedCount) {
        finalWords = unique.slice(0, requestedCount);
      }

      answer = finalWords.join(", ");
    }

    res.json({ answer });
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "AI error" });
  }
});
