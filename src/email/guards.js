/**
 * Decide whether the worker should auto-reply to this email.
 * `parsed` is the object returned by postal-mime.
 */
export function shouldReply(parsed, cfg) {
  const headers = parsed.headers || [];
  const get = (name) => {
    const n = name.toLowerCase();
    return headers.find((h) => h.key.toLowerCase() === n)?.value || "";
  };

  // RFC 3834: never reply to automated mail.
  const autoSubmitted = get("auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return false;

  // Mailing list markers.
  if (get("list-id") || get("list-unsubscribe")) return false;

  const precedence = get("precedence").toLowerCase();
  if (["bulk", "junk", "list"].includes(precedence)) return false;

  // Autoresponder suppress hint.
  const suppress = get("x-auto-response-suppress").toLowerCase();
  if (suppress && !suppress.includes("none")) return false;

  // Delivery status / bounce reports.
  const contentType = get("content-type").toLowerCase();
  if (contentType.includes("multipart/report") || contentType.includes("delivery-status")) return false;

  // Domain allow/block lists (evaluated against the sender address).
  const senderDomain = domainOf(parsed.from?.address || "");
  if (cfg.blockDomains.length && senderDomain && cfg.blockDomains.includes(senderDomain)) return false;
  if (cfg.allowDomains.length && senderDomain && !cfg.allowDomains.includes(senderDomain)) return false;

  return true;
}

/** Pick the best reply-to address from the parsed email. */
export function resolveReplyTo(parsed, fallback) {
  return parsed.replyTo?.[0]?.address || parsed.from?.address || fallback || "";
}

function domainOf(addr) {
  const m = /@([^>\s]+)/.exec(addr || "");
  return m ? m[1].toLowerCase() : "";
}
