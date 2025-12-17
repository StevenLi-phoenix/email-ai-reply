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
    log.info("received", {
      to: recipients.join(","),
      from: message.from,
      subject: message.headers.get("Subject") || "",
      time: new Date().toISOString(),
    });

    try {
      // Only handle incoming mail for our address
      if (!recipients.some((r) => String(r).toLowerCase().includes(cfg.serviceAddress))) {
        message.reject();
        return;
      }

      // Decode raw email
      const rawBuffer = await new Response(message.raw).arrayBuffer();
      const parsed = parseEmail(new Uint8Array(rawBuffer));

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
      const aiText = await generateReply({ cfg, subject, content: userContent, log });

      // Compose MIME reply (text + optional HTML)
      const composed = composeReply({
        cfg,
        to: replyTo,
        original: parsed,
        replyText: aiText,
      });

      const replyMsg = new EmailMessage(
        cfg.fromAddress,
        replyTo,
        composed.stream
      );

      await message.reply(replyMsg);
      log.info("sent", {
        to: replyTo,
        subject: composed.subject,
        bytes: composed.size,
        snippet: redact(aiText, 256),
      });
    } catch (error) {
      log.error("failed", { error: error?.stack || String(error) });
      // Best-effort apology reply
      try {
        const fallback = composeReply({
          cfg,
          to: message.from,
          original: {
            subject: message.headers.get("Subject") || "",
            headers: new Map(),
            messageId: message.headers.get("Message-ID") || "",
            references: "",
            inReplyTo: "",
            text: "",
            htmlText: "",
            date: new Date().toUTCString(),
            from: message.from,
          },
          replyText:
            "I apologize, but I encountered an error while processing your email. Please try again later.",
        });

        const replyMsg = new EmailMessage(cfg.fromAddress, message.from, fallback.stream);
        await message.reply(replyMsg);
      } catch (replyErr) {
        log.error("notify_failed", { error: replyErr?.stack || String(replyErr) });
      }
    }
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
