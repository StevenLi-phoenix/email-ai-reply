export function createLog(component) {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    info: (event, data) => emit("info", component, id, event, data),
    warn: (event, data) => emit("warn", component, id, event, data),
    error: (event, data) => emit("error", component, id, event, data),
  };
}

function emit(level, component, id, event, data = {}) {
  const entry = { level, component, id, event, time: new Date().toISOString(), ...data };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}
