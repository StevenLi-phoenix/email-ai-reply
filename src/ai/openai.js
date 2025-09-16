export async function generateReply({ cfg, subject, content, log }) {
  const trimmed = trimForTokens(content || "", 3000);
  const system = cfg.systemPrompt;
  const user = buildUserPrompt(subject, trimmed);

  if (!cfg.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`OpenAI API error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI returned empty response");
  return text;
}

function buildUserPrompt(subject, content) {
  const subj = subject ? `Subject: ${subject}\n\n` : "";
  return `${subj}${content}`.slice(0, 12000);
}

function trimForTokens(text, approxChars) {
  if (!text) return "";
  // naive char-based truncation; prioritize latest content
  const s = String(text);
  return s.length > approxChars ? s.slice(-approxChars) : s;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}
