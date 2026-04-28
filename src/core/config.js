export function loadConfig(env = {}) {
  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAIKey = Boolean(env.OPENAI_API_KEY);

  // Auto-detect provider: explicit AI_PROVIDER wins; otherwise prefer whichever key is present.
  const provider = resolveProvider(env.AI_PROVIDER, hasAnthropicKey, hasOpenAIKey);

  const cfg = {
    provider,

    // ── OpenAI ──────────────────────────────────────────────────────────────
    model: env.OPENAI_MODEL || "gpt-5.2",
    apiKey: env.OPENAI_API_KEY || "",
    baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, ""),
    enableWebSearch: toBool(env.OPENAI_ENABLE_WEB_SEARCH, true),
    enablePython: toBool(env.OPENAI_ENABLE_PYTHON, true),

    // ── Anthropic ────────────────────────────────────────────────────────────
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    anthropicModel: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    anthropicBaseUrl: (env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),

    // ── Shared ───────────────────────────────────────────────────────────────
    systemPrompt:
      env.SystemPrompt ||
      "You are an assistant that drafts concise, polite, and professional email replies. Keep responses brief and actionable.",
    maxTokens: toInt(env.MAX_TOKENS, 700),
    maxCompletionTokens: toInt(env.MAX_COMPLETION_TOKENS, toInt(env.MAX_TOKENS, 700)),
    // Legacy: only include temperature when explicitly configured (some models reject it).
    temperature: hasValue(env.TEMPERATURE) ? toFloat(env.TEMPERATURE, undefined) : undefined,
    timeoutMs: toInt(env.OPENAI_TIMEOUT_MS, 20000),
    allowDomains: parseCsv(env.ALLOW_DOMAINS),
    blockDomains: parseCsv(env.BLOCK_DOMAINS),
  };

  // Basic validation
  if (provider === "anthropic" && !cfg.anthropicApiKey) {
    console.warn("ANTHROPIC_API_KEY is not set; AI replies will fail.");
  } else if (provider === "openai" && !cfg.apiKey) {
    console.warn("OPENAI_API_KEY is not set; AI replies will fail.");
  }

  return cfg;
}

function resolveProvider(explicit, hasAnthropic, hasOpenAI) {
  const v = String(explicit || "").trim().toLowerCase();
  if (v === "anthropic") return "anthropic";
  if (v === "openai") return "openai";
  // Auto-detect: Anthropic wins when only its key is present.
  if (hasAnthropic && !hasOpenAI) return "anthropic";
  return "openai";
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
