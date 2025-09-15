export function shouldReply(headers, cfg) {
  const h = (name) => (headers.get ? headers.get(name) : null) || "";
  const auto = (h("auto-submitted") || "").toLowerCase();
  if (auto && auto !== "no") return false;

  const precedence = (h("precedence") || "").toLowerCase();
  if (["bulk", "junk", "list"].includes(precedence)) return false;

  if (h("list-id")) return false;
  const suppress = (h("x-auto-response-suppress") || "").toLowerCase();
  if (/(all|dr|rn|autoreply)/.test(suppress)) return false;

  // Optional domain allow/block lists
  const from = (h("reply-to") || h("from") || "").toLowerCase();
  const dom = domainOf(from);
  if (cfg.blockDomains?.length && dom && cfg.blockDomains.includes(dom)) return false;
  if (cfg.allowDomains?.length && dom && !cfg.allowDomains.includes(dom)) return false;
  return true;
}

export function resolveReplyTo(parsed, fallbackFrom) {
  const hdr = parsed?.headers;
  if (hdr) {
    const rt = hdr.get("reply-to");
    if (rt) return extractEmail(rt) || fallbackFrom;
  }
  return extractEmail(parsed?.from) || fallbackFrom;
}

function domainOf(addr) {
  const m = /@([^>\s]+)/.exec(addr || "");
  return m ? m[1] : "";
}

function extractEmail(v) {
  if (!v) return "";
  const m = /<([^>]+)>/.exec(v);
  if (m) return m[1];
  const at = /[^\s]+@[^\s]+/.exec(v);
  return at ? at[0] : v.trim();
}

