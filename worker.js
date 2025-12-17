import { EmailMessage } from "cloudflare:email";
import { loadConfig } from "./src/core/config.js";
import { createLog, redact } from "./src/core/log.js";
import { parseEmail } from "./src/email/parse.js";
import { shouldReply, resolveReplyTo } from "./src/email/guards.js";
import { composeReply } from "./src/email/compose.js";
import { generateReply } from "./src/ai/openai.js";

export default {
  async email(message, env, ctx) {
    const cfg = loadConfig(env);
    const log = createLog({ component: "email" });
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const fromAddress = extractEmail(String(recipients[0] || ""));
    log.info("received", {
      to: recipients.join(","),
      from: message.from,
      subject: message.headers.get("Subject") || "",
      time: new Date().toISOString(),
    });

    // Cloudflare Email Routing already decides which messages reach this Worker.
    // Use the routed recipient address as the "From" for replies (required by gateway/domain constraints).
    if (!fromAddress) {
      log.error("missing_routed_to", { to: recipients.join(",") });
      return;
    }

    // Decode raw email
    const rawBuffer = await new Response(message.raw).arrayBuffer();
    const rawSize = rawBuffer.byteLength;
    // Cloudflare Email has limits on which messages can be replied to; fail fast and notify sender.
    if (rawSize > 64_000) {
      log.warn("too_large", { rawSize });
      rejectWithHint(
        message,
        "自动回复失败：邮件过大，Cloudflare 无法对该邮件执行 reply。请移除附件/长邮件链后重新发送一封更短的邮件再试。\n\nAuto-reply failed: email too large to reply. Please resend a shorter message (remove attachments / long quoted history)."
      );
      return;
    }
    const parsed = parseEmail(new Uint8Array(rawBuffer));
    const originalMessageId =
      message.headers.get("Message-ID") ||
      message.headers.get("Message-Id") ||
      parsed.messageId ||
      "";
    const original = { ...parsed, messageId: originalMessageId };

    // Safety and policy checks
    if (!shouldReply(parsed.headers, cfg)) {
      log.info("skipping_auto", {
        reason: "policy",
        from: parsed.from || message.from,
      });
      return; // drop silently
    }

    const replyTo = resolveReplyTo(parsed, message.from);

    // Prepare prompt content for AI
    const subject = parsed.subject || message.headers.get("Subject") || "";
    const userContent = (
      parsed.textMain ||
      parsed.htmlTextMain ||
      parsed.text ||
      parsed.htmlText ||
      ""
    ).trim();

    // Generate AI reply
    const aiText = await generateReply({ cfg, subject, content: userContent });

    // Compose MIME reply (text + optional HTML)
    const composed = composeReply({
      fromAddress,
      to: replyTo,
      original,
      replyText: aiText,
    });

    const replyMsg = new EmailMessage(fromAddress, replyTo, composed.stream);
    try {
      await message.reply(replyMsg);
    } catch (err) {
      const msg = err?.message || String(err);
      log.error("reply_failed", { error: msg });
      if (/not repliable|exceeds reply limit/i.test(msg)) {
        rejectWithHint(
          message,
          "自动回复失败：该邮件不可回复或已超过 Cloudflare reply 限制。请发送更短的邮件（移除附件/长引用）后重试。\n\nAuto-reply failed: email not repliable or reply limit exceeded. Please resend a shorter message."
        );
        return;
      }
      throw err;
    }
    log.info("sent", {
      to: replyTo,
      subject: composed.subject,
      bytes: composed.size,
      snippet: redact(aiText, 256),
    });
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const cfg = loadConfig(env);
      return new Response(
        JSON.stringify({ ok: true, service: "email-ai-reply", model: cfg.model, time: Date.now() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
  },
};

function extractEmail(v) {
  if (!v) return "";
  const m = /<([^>]+)>/.exec(v);
  if (m) return m[1];
  const at = /[^\s]+@[^\s]+/.exec(v);
  return at ? at[0] : v.trim();
}

function rejectWithHint(message, reason) {
  try {
    if (typeof message?.setReject === "function") {
      message.setReject(reason);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
