export async function generateReply({ cfg, subject, content, log }) {
  const trimmed = trimForTokens(content || "", 3000);
  const system = cfg.systemPrompt;
  const user = buildUserPrompt(subject, trimmed);

  if (!cfg.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const tools = [];
  if (cfg.enableWebSearch) tools.push({ type: "web_search_preview" });
  if (cfg.enablePython) tools.push({ type: "code_interpreter", container: { type: "auto" } });

  const body = {
    model: cfg.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              system +
              "\n\nTool policy:\n- You may use web search to verify facts or fetch current info, but never include sensitive email content or personal data in search queries.\n- You may use Python for calculations, parsing, or drafting help when useful.\n",
          },
        ],
      },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
    ...(tools.length ? { tools } : {}),
    max_output_tokens: cfg.maxCompletionTokens,
    temperature: cfg.temperature,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`OpenAI API error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = extractOutputText(data)?.trim();
  if (!text) throw new Error("AI returned empty response");
  return text;
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
