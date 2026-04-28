import { EmailMessage } from "cloudflare:email";
import PostalMime from "postal-mime";
import { loadConfig } from "./src/core/config.js";
import { createLog } from "./src/core/log.js";
import { shouldReply, resolveReplyTo } from "./src/email/guards.js";
import { composeReply } from "./src/email/compose.js";
import { generateReply } from "./src/ai/client.js";

// Cloudflare's reply() API fails on emails larger than ~64KB.
const MAX_RAW_BYTES = 64_000;

export default {
  async email(message, env, ctx) {
    const cfg = loadConfig(env);
    const log = createLog("worker");

    // 1. Buffer the raw email so we can size-check and hand to postal-mime.
    const rawBuffer = await new Response(message.raw).arrayBuffer();

    if (rawBuffer.byteLength > MAX_RAW_BYTES) {
      log.warn("too_large", { bytes: rawBuffer.byteLength });
      rejectWithHint(
        message,
        "Auto-reply failed: email too large. Please resend without attachments or long quoted history."
      );
      return;
    }

    // 2. Parse with postal-mime (handles charsets, nested multipart, RFC 2047, attachments).
    let parsed;
    try {
      parsed = await PostalMime.parse(rawBuffer);
    } catch (err) {
      log.error("parse_failed", { error: err.message });
      return;
    }

    const subject = parsed.subject || "";
    const from = parsed.from?.address || message.from || "";
    const routedTo = extractEmail(String([message.to].flat()[0] || ""));

    log.info("received", { to: routedTo, from, subject });

    if (!routedTo) {
      log.error("no_routed_to");
      return;
    }

    // 3. Policy checks — should we actually reply?
    if (!shouldReply(parsed, cfg)) {
      log.info("skipped", { from });
      return;
    }

    const replyTo = resolveReplyTo(parsed, from);

    // 4. Inject runtime context into system prompt (datetime, envelope info).
    cfg.systemPrompt = injectRuntimeContext(cfg.systemPrompt, { from, to: routedTo });

    // 5. Build the AI prompt from the parsed plain-text body.
    const userContent = (parsed.text || htmlToText(parsed.html) || "").trim();

    // 6. Generate reply (Anthropic primary → OpenAI fallback).
    let aiText;
    try {
      aiText = await generateReply({ cfg, subject, content: userContent });
    } catch (err) {
      log.error("ai_failed", { error: err.message });
      rejectWithHint(message, "Auto-reply temporarily unavailable. Please try again later.");
      return;
    }

    // 7. Compose MIME reply with proper threading and anti-loop headers.
    const composed = composeReply({
      from: routedTo,
      to: replyTo,
      original: {
        subject,
        messageId: parsed.messageId || "",
        references: getHeader(parsed.headers, "references"),
      },
      replyText: aiText,
    });

    // 8. Send.
    try {
      const replyMsg = new EmailMessage(routedTo, replyTo, composed.stream);
      await message.reply(replyMsg);
      log.info("sent", { to: replyTo, subject: composed.subject, bytes: composed.size });
    } catch (err) {
      log.error("reply_failed", { error: err.message });
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "email-ai-reply", time: Date.now() });
    }
    return new Response("Not Found", { status: 404 });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Append a runtime context block to the base system prompt.
 * Called once per request so datetime and envelope info are always fresh.
 */
function injectRuntimeContext(basePrompt, { from, to }) {
  const now = new Date();
  const lines = [
    "---",
    "## Runtime context (injected at request time)",
    `Date/time: ${now.toUTCString()}`,
    `Day: ${now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })}`,
    `Inbox address: ${to}`,
    `Sender address: ${from}`,
  ];
  return `${basePrompt}\n\n${lines.join("\n")}`;
}

function extractEmail(v) {
  if (!v) return "";
  // Match the addr-spec inside angle brackets, requiring an @.
  const bracketed = /<([^>]+@[^>]+)>/.exec(v);
  if (bracketed) return bracketed[1].trim();
  // Bare address fallback.
  const bare = /[^\s<>"]+@[^\s<>"]+/.exec(v);
  return bare ? bare[0].trim() : "";
}

function getHeader(headers, name) {
  const n = name.toLowerCase();
  return (headers || []).find((h) => h.key.toLowerCase() === n)?.value || "";
}

function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function rejectWithHint(message, reason) {
  try {
    if (typeof message?.setReject === "function") message.setReject(reason);
  } catch {
    // setReject is best-effort; not all message types support it.
  }
}
