import { createMimeMessage } from "mimetext";

/**
 * Build a reply MIME message.
 *
 * @param {object} opts
 * @param {string} opts.from        - Sender address (the routed Worker address)
 * @param {string} opts.to          - Recipient address
 * @param {object} opts.original    - { subject, messageId, references }
 * @param {string} opts.replyText   - AI-generated reply body
 * @returns {{ stream: ReadableStream, subject: string, size: number }}
 */
export function composeReply({ from, to, original, replyText }) {
  const subject = ensureRe(sanitizeHeader(original.subject || ""));

  const msg = createMimeMessage();
  msg.setSender(from);
  msg.setRecipient(to);
  msg.setSubject(subject);

  // Threading headers
  if (original.messageId) {
    const mid = wrapMsgId(original.messageId);
    msg.setHeader("In-Reply-To", mid);
    const refs = [original.references, mid].filter(Boolean).join(" ").trim();
    if (refs) msg.setHeader("References", refs);
  }

  // Anti-loop headers (RFC 3834) — prevent autoresponder chains.
  msg.setHeader("Auto-Submitted", "auto-replied");
  msg.setHeader("Precedence", "bulk");
  msg.setHeader("X-Auto-Response-Suppress", "All");

  msg.addMessage({ contentType: "text/plain", data: replyText });

  const raw = msg.asRaw();
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return { stream, subject, size: bytes.length };
}

function ensureRe(s) {
  return /^\s*re:/i.test(s) ? s : `Re: ${s || "(no subject)"}`;
}

function wrapMsgId(id) {
  const s = String(id).trim();
  return s.startsWith("<") ? s : `<${s}>`;
}

function sanitizeHeader(v) {
  return String(v).replace(/[\r\n]+/g, " ").trim();
}
