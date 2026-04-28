import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createLog } from "../core/log.js";

const log = createLog("ai");

/**
 * Generate an email reply using Anthropic Claude (primary) with OpenAI as HA fallback.
 * Falls back to OpenAI on any Anthropic error except auth failures.
 */
export async function generateReply({ cfg, subject, content }) {
  const userText = buildPrompt(subject, content);

  if (cfg.anthropicApiKey) {
    try {
      const text = await callAnthropic(cfg, userText);
      log.info("anthropic_ok", { model: cfg.anthropicModel, chars: text.length });
      return text;
    } catch (err) {
      // Auth errors indicate misconfiguration — no point trying the fallback.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw err;
      }
      log.warn("anthropic_failed", { error: err.message, will_fallback: Boolean(cfg.openaiApiKey) });
      if (!cfg.openaiApiKey) throw err;
      // Fall through to OpenAI.
    }
  }

  if (cfg.openaiApiKey) {
    const text = await callOpenAI(cfg, userText);
    log.info("openai_ok", { model: cfg.openaiModel, chars: text.length });
    return text;
  }

  throw new Error("No AI provider configured — set ANTHROPIC_API_KEY and/or OPENAI_API_KEY.");
}

async function callAnthropic(cfg, userText) {
  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey,
    baseURL: cfg.anthropicBaseUrl,
  });

  const response = await client.messages.create(
    {
      model: cfg.anthropicModel,
      max_tokens: cfg.maxOutputTokens,
      system: cfg.systemPrompt,
      messages: [{ role: "user", content: userText }],
    },
    { timeout: cfg.timeoutMs }
  );

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function callOpenAI(cfg, userText) {
  const client = new OpenAI({
    apiKey: cfg.openaiApiKey,
    baseURL: cfg.openaiBaseUrl,
    timeout: cfg.timeoutMs,
  });

  const tools = [];
  if (cfg.openaiEnableWebSearch) tools.push({ type: "web_search_preview" });

  const response = await client.responses.create({
    model: cfg.openaiModel,
    instructions: cfg.systemPrompt,
    input: userText,
    max_output_tokens: cfg.maxOutputTokens,
    ...(tools.length ? { tools } : {}),
  });

  return (response.output_text || "").trim();
}

function buildPrompt(subject, content) {
  const parts = [];
  if (subject) parts.push(`Subject: ${subject}`);
  // Keep the newest content; cap to avoid token waste.
  if (content) parts.push(content.slice(0, 8000));
  return parts.join("\n\n");
}
