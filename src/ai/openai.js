export async function generateReply({ cfg, subject, content }) {
  const trimmed = trimForTokens(content || "", 3000);
  const user = buildUserPrompt(subject, trimmed);

  if (!cfg.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const body = buildResponsesBody(cfg, user);
    const result = await callResponses(cfg, body, controller.signal);

    if (!result.ok) {
      throw new Error(`OpenAI API error ${result.status}: ${String(result.text || "").slice(0, 400)}`);
    }

    const text = extractOutputText(result.json)?.trim();
    if (!text) throw new Error("AI returned empty response");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

const TOOL_POLICY =
  "Tool policy:\n" +
  "- You may use web search to verify facts or fetch current info, but never include sensitive email content or personal data in search queries.\n" +
  "- You may use Python for calculations, parsing, or drafting help when useful.\n";

function buildResponsesBody(cfg, userText) {
  const input = [
    {
      role: "system",
      content: [{ type: "input_text", text: `${cfg.systemPrompt}\n\n${TOOL_POLICY}` }],
    },
    { role: "user", content: [{ type: "input_text", text: userText }] },
  ];

  const tools = buildTools(cfg);

  const body = {
    model: cfg.model,
    input,
    ...(tools.length ? { tools } : {}),
    max_output_tokens: cfg.maxCompletionTokens,
  };

  // Legacy (optional): only include temperature when explicitly configured.
  if (Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature;

  return body;
}

function buildTools(cfg) {
  const tools = [];
  if (cfg.enableWebSearch) tools.push({ type: "web_search_preview" });
  if (cfg.enablePython) tools.push({ type: "code_interpreter", container: { type: "auto" } });
  return tools;
}

async function callResponses(cfg, body, signal) {
  const res = await fetch(`${cfg.baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await safeText(res);
  const json = safeParseJson(text);
  return { ok: res.ok, status: res.status, text, json };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractOutputText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string") return data.output_text;
  const out = data.output;
  if (!Array.isArray(out)) return "";
  const chunks = [];
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
    }
  }
  return chunks.join("\n");
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
