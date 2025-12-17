export function loadConfig(env = {}) {
  const cfg = {
    model: env.OPENAI_MODEL || "gpt-5.2",
    apiKey: env.OPENAI_API_KEY || "",
    baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""),
    systemPrompt:
      env.SystemPrompt ||
      "You are an assistant that drafts concise, polite, and professional email replies. Keep responses brief and actionable.",
    maxTokens: toInt(env.MAX_TOKENS, 700),
    maxCompletionTokens: toInt(env.MAX_COMPLETION_TOKENS, toInt(env.MAX_TOKENS, 700)),
    // Legacy: only include temperature when explicitly configured (some models reject it).
    temperature: hasValue(env.TEMPERATURE) ? toFloat(env.TEMPERATURE, undefined) : undefined,
    timeoutMs: toInt(env.OPENAI_TIMEOUT_MS, 20000),
    enableWebSearch: toBool(env.OPENAI_ENABLE_WEB_SEARCH, true),
    enablePython: toBool(env.OPENAI_ENABLE_PYTHON, true),
    allowDomains: parseCsv(env.ALLOW_DOMAINS),
    blockDomains: parseCsv(env.BLOCK_DOMAINS),
  };

  // Basic validation with safe fallbacks
  if (!cfg.apiKey) {
    // In production this should hard-fail; for safety we allow execution but will error at callsite
    console.warn("OPENAI_API_KEY is not set; AI replies will fail.");
  }
  return cfg;
}

function toInt(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function toFloat(v, d) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function hasValue(v) {
  return !(v == null || String(v).trim() === "");
}

function toBool(v, d) {
  if (v == null || v === "") return d;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return d;
}

function parseCsv(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
