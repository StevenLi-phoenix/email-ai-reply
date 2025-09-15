function id() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toUpperCase();
}

export function createLog(ctx = {}) {
  const trace = id();
  const base = { trace, ...ctx };
  return {
    info(ev, data = {}) {
      console.log(JSON.stringify({ level: "info", ev, ...base, ...safe(data) }));
    },
    warn(ev, data = {}) {
      console.warn(JSON.stringify({ level: "warn", ev, ...base, ...safe(data) }));
    },
    error(ev, data = {}) {
      console.error(JSON.stringify({ level: "error", ev, ...base, ...safe(data) }));
    },
  };
}

function safe(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return { note: "log_serialize_failed" };
  }
}

export function redact(text, max = 256) {
  if (!text) return "";
  const s = String(text);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

