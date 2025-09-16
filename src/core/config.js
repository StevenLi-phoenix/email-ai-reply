export function loadConfig(env = {}) {
  const cfg = {
    model: env.OPENAI_MODEL || "gpt-4o-mini",
    apiKey: env.OPENAI_API_KEY || "",
    systemPrompt:
      env.SystemPrompt ||
      "You are an assistant that drafts concise, polite, and professional email replies. Keep responses brief and actionable.",
    maxTokens: toInt(env.MAX_TOKENS, 700),
    maxCompletionTokens: toInt(env.MAX_COMPLETION_TOKENS, toInt(env.MAX_TOKENS, 700)),
    temperature: toFloat(env.TEMPERATURE, 0.5),
    timeoutMs: toInt(env.OPENAI_TIMEOUT_MS, 20000),
    fromAddress: env.FROM_ADDRESS || "ai@lishuyu.app",
    serviceAddress: (env.SERVICE_ADDRESS || "ai@lishuyu.app").toLowerCase(),
    allowDomains: parseCsv(env.ALLOW_DOMAINS),
    blockDomains: parseCsv(env.BLOCK_DOMAINS),
    domain: env.MAIL_DOMAIN || "ai.lishuyu.app",
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

function parseCsv(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
