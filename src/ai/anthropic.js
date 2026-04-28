const ANTHROPIC_API_VERSION = "2023-06-01";

export async function generateReply({ cfg, subject, content }) {
  const trimmed = trimForTokens(content || "", 3000);
  const user = buildUserPrompt(subject, trimmed);

  if (!cfg.anthropicApiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const body = buildMessagesBody(cfg, user);
    const result = await callMessages(cfg, body, controller.signal);

    if (!result.ok) {
      throw new Error(
        `Anthropic API error ${result.status}: ${String(result.text || "").slice(0, 400)}`
      );
    }

    const text = extractText(result.json)?.trim();
    if (!text) throw new Error("AI returned empty response");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function buildMessagesBody(cfg, userText) {
  return {
    model: cfg.anthropicModel,
    max_tokens: cfg.maxCompletionTokens,
    system: cfg.systemPrompt,
    messages: [{ role: "user", content: userText }],
  };
}

async function callMessages(cfg, body, signal) {
  const res = await fetch(`${cfg.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": cfg.anthropicApiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await safeText(res);
  const json = safeParseJson(text);
  return { ok: res.ok, status: res.status, text, json };
}

function extractText(data) {
  if (!data) return "";
  const content = data.content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}

function buildUserPrompt(subject, content) {
  const subj = subject ? `Subject: ${subject}\n\n` : "";
  return `${subj}${content}`.slice(0, 12000);
}

function trimForTokens(text, approxChars) {
  if (!text) return "";
  const s = String(text);
  return s.length > approxChars ? s.slice(-approxChars) : s;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
