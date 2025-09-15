// Minimal MIME and header parsing sufficient for common emails.

const CRLF = "\r\n";

export function parseEmail(rawBytes) {
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
  const splitIndex = raw.indexOf("\r\n\r\n");
  const altIndex = raw.indexOf("\n\n");
  const idx = splitIndex >= 0 ? splitIndex : altIndex >= 0 ? altIndex : -1;
  let headerText = raw;
  let bodyText = "";
  if (idx >= 0) {
    headerText = raw.slice(0, idx);
    bodyText = raw.slice(idx).replace(/^\r?\n\r?\n/, "");
  }

  const headers = parseHeaders(headerText);
  const ct = headers.get("content-type") || "text/plain";
  const cte = (headers.get("content-transfer-encoding") || "").toLowerCase();

  // Decode whole-body by its CTE for single-part emails
  let decodedBody = decodeByCTE(bodyText, cte);

  let text = null;
  let html = null;

  if (/^multipart\//i.test(ct)) {
    const boundary = getBoundary(ct);
    if (boundary) {
      const parts = splitMultipart(decodedBody, boundary);
      for (const p of parts) {
        const pCte = (p.headers.get("content-transfer-encoding") || "").toLowerCase();
        const pCt = p.headers.get("content-type") || "text/plain";
        const payload = decodeByCTE(p.body, pCte);
        if (/^text\/plain/i.test(pCt) && text == null) text = decodeText(payload, pCt);
        if (/^text\/html/i.test(pCt) && html == null) html = decodeText(payload, pCt);
      }
    } else {
      // Fallback: treat as plain
      text = decodedBody;
    }
  } else if (/^text\/html/i.test(ct)) {
    html = decodeText(decodedBody, ct);
  } else {
    text = decodeText(decodedBody, ct);
  }

  const subject = headers.get("subject") || "";
  const from = headers.get("reply-to") || headers.get("from") || "";
  const to = headers.get("to") || "";
  const date = headers.get("date") || new Date().toUTCString();
  const messageId = headers.get("message-id") || "";
  const references = headers.get("references") || "";
  const inReplyTo = headers.get("in-reply-to") || "";

  return {
    headers,
    subject,
    from,
    to,
    date,
    messageId,
    references,
    inReplyTo,
    text: text ? normalizeNewlines(stripQuotedNoise(text)) : null,
    htmlText: html ? stripHtml(html) : null,
  };
}

export function parseHeaders(headerText) {
  const headers = new Map();
  const lines = headerText.split(/\r?\n/);
  let currentName = null;
  let currentVal = "";
  function commit() {
    if (currentName) headers.set(currentName.toLowerCase(), currentVal.trim());
    currentName = null;
    currentVal = "";
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) {
      currentVal += " " + line.trim();
      continue;
    }
    if (currentName) commit();
    const idx = line.indexOf(":");
    if (idx > 0) {
      currentName = line.slice(0, idx);
      currentVal = line.slice(idx + 1).trim();
    }
  }
  if (currentName) commit();
  return headers;
}

function getBoundary(ct) {
  const m = /boundary="?([^";]+)"?/i.exec(ct);
  return m ? m[1] : null;
}

function splitMultipart(body, boundary) {
  const delim = "--" + boundary;
  const end = delim + "--";
  const lines = body.split(/\r?\n/);
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith(delim)) {
      // consume headers
      i++;
      let headerLines = [];
      for (; i < lines.length; i++) {
        if (lines[i] === "") { i++; break; }
        headerLines.push(lines[i]);
      }
      let partBody = [];
      for (; i < lines.length; i++) {
        if (lines[i].startsWith(delim)) break;
        partBody.push(lines[i]);
      }
      chunks.push({
        headers: parseHeaders(headerLines.join("\r\n")),
        body: partBody.join("\r\n"),
      });
    } else {
      i++;
    }
    if (lines[i] && lines[i].startsWith(end)) break;
  }
  return chunks;
}

function decodeByCTE(text, cte) {
  if (!text) return "";
  if (cte === "base64") {
    try {
      const bin = atob(text.replace(/\s+/g, ""));
      return bin;
    } catch { return text; }
  }
  if (cte === "quoted-printable") {
    return decodeQuotedPrintable(text);
  }
  return text;
}

function decodeQuotedPrintable(str) {
  // Basic QP: =HH hex sequences and soft line breaks "=\r\n"
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeText(payload, ct) {
  const charsetMatch = /charset=([^;]+)/i.exec(ct);
  const charset = charsetMatch ? charsetMatch[1].trim().replace(/"/g, "") : "utf-8";
  try {
    const bytes = new Uint8Array([...payload].map((c) => c.charCodeAt(0)));
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return payload;
  }
}

function normalizeNewlines(s) { return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }

function stripHtml(html) {
  // quick sanitize to text
  const txt = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return normalizeNewlines(txt).trim();
}

function stripQuotedNoise(text) {
  // Remove long quoted history beyond first separator (common heuristics)
  const separators = [
    /^\s*-{2,}\s*Original Message\s*-{2,}$/im,
    /^On .*wrote:\s*$/im,
    /^From:\s.*$/im,
  ];
  for (const re of separators) {
    const m = re.exec(text);
    if (m && m.index > 20) {
      return text.slice(0, m.index).trim();
    }
  }
  return text;
}

