// Übernimmt man eine Variante, merkt sich die App Stufe und Original-Plan im
// Kalender-Eintrag selbst (letzte Zeile der Beschreibung). So funktioniert
// "Rückgängig" auf jedem Gerät, und push_plan_events.py erkennt angepasste
// Einträge und überschreibt sie nicht.
const RE = /\n*\[hc:(\w+):([A-Za-z0-9+/=]+)\]\s*$/;
const enc = (s) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

export const strip = (desc = "") => (desc || "").replace(RE, "");
export const pack = (desc, level, orig) => `${strip(desc)}\n\n[hc:${level}:${enc(JSON.stringify(orig))}]`;
export function unpack(desc = "") {
  const m = RE.exec(desc || "");
  if (!m) return null;
  try { return { level: m[1], orig: JSON.parse(dec(m[2])) }; } catch { return null; }
}
// Die ursprünglich geplante Einheit, auch wenn gerade eine Variante im Kalender steht
export const planOf = (ev) => { const m = unpack(ev.description); return m ? { ...ev, ...m.orig } : ev; };
