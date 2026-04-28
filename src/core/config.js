export function loadConfig(env = {}) {
  return {
    // Anthropic (primary provider)
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicModel: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    anthropicBaseUrl: trimSlash(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"),

    // OpenAI (fallback provider)
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: env.OPENAI_MODEL || "gpt-5.2",
    openaiBaseUrl: trimSlash(env.OPENAI_BASE_URL || "https://api.openai.com"),
    openaiEnableWebSearch: toBool(env.OPENAI_ENABLE_WEB_SEARCH, true),

    // Shared
    systemPrompt:
      env.SYSTEM_PROMPT ||
      "You are an assistant that drafts concise, polite, and professional email replies. Keep responses brief and actionable.",
    maxOutputTokens: toInt(env.MAX_OUTPUT_TOKENS, 1024),
    timeoutMs: toInt(env.TIMEOUT_MS, 30_000),

    // Routing filters
    allowDomains: parseCsv(env.ALLOW_DOMAINS),
    blockDomains: parseCsv(env.BLOCK_DOMAINS),
  };
}

function toInt(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function toBool(v, d) {
  if (v == null || v === "") return d;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return d;
}

function parseCsv(v) {
  if (!v) return [];
  return String(v).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function trimSlash(s) {
  return String(s).replace(/\/+$/, "");
}
