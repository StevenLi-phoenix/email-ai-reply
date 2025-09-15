const CRLF = "\r\n";

export function composeReply({ cfg, to, original, replyText }) {
  const subject = ensureRe(original.subject || "");
  const msgId = makeMessageId(cfg.domain);
  const refs = buildReferences(original);

  // Plain text body
  const quoted = quoteOriginal(original);
  const textBody = `${replyText}\n\n${quoted}`.replace(/\r?\n/g, "\n");

  // Simple HTML version mirroring text
  const htmlBody = `<!doctype html><html><body><div>${escapeHtml(
    replyText
  ).replace(/\n/g, "<br>")}</div><hr><blockquote style="border-left:3px solid #ccc;padding-left:8px;color:#555">${escapeHtml(
    (original.text || original.htmlText || "").slice(0, 4000)
  ).replace(/\n/g, "<br>")}</blockquote></body></html>`;

  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `Message-ID: ${msgId}`,
    refs.inReplyTo ? `In-Reply-To: ${refs.inReplyTo}` : null,
    refs.references ? `References: ${refs.references}` : null,
    `Subject: ${subject}`,
    `From: AI Email Assistant <${cfg.fromAddress}>`,
    `To: ${to}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join(CRLF);

  const body =
    `--${boundary}${CRLF}` +
    `Content-Type: text/plain; charset=utf-8${CRLF}` +
    `Content-Transfer-Encoding: 8bit${CRLF}${CRLF}` +
    textBody.replace(/\n/g, CRLF) +
    `${CRLF}--${boundary}${CRLF}` +
    `Content-Type: text/html; charset=utf-8${CRLF}` +
    `Content-Transfer-Encoding: 8bit${CRLF}${CRLF}` +
    htmlBody.replace(/\n/g, CRLF) +
    `${CRLF}--${boundary}--${CRLF}`;

  const raw = headers + CRLF + CRLF + body;
  const bytes = new TextEncoder().encode(raw);

  return {
    subject,
    size: bytes.byteLength,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function ensureRe(s) {
  return /^\s*re:/i.test(s) ? s : (s ? `Re: ${s}` : "Re:");
}

function makeMessageId(domain) {
  const token = `${Date.now()}.${Math.random().toString(36).slice(2, 11)}`;
  return `<${token}@${domain}>`;
}

function buildReferences(orig) {
  const inReplyTo = orig.inReplyTo || orig.messageId || "";
  let chain = [];
  if (orig.references) chain.push(orig.references);
  if (orig.messageId) chain.push(orig.messageId);
  const references = chain.filter(Boolean).join(" ");
  return { inReplyTo, references };
}

function quoteOriginal(orig) {
  const date = orig.date || new Date().toUTCString();
  const from = orig.from || "";
  const subj = orig.subject || "";
  const content = (orig.text || orig.htmlText || "").trim();
  const quoted = content
    .split(/\r?\n/)
    .map((l) => "> " + l)
    .join("\n");
  return `On ${date}, ${from} wrote:\nSubject: ${subj}\n\n${quoted}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

