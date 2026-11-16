// intervals.icu-Client. intervals.icu ist die einzige Datenquelle (Single Source
// of Truth): Die App liest live und schreibt Check-ins und Plananpassungen dorthin.
// Der API-Key liegt nur im localStorage dieses Geräts.

const BASE = "https://intervals.icu/api/v1";
const LS_KEY = "hc.intervalsKey";
const LS_DEMO = "hc.demoWrites";

export const isDemo = () => new URLSearchParams(location.search).has("demo");
export const getKey = () => { try { return localStorage.getItem(LS_KEY) || ""; } catch { return ""; } };
export const setKey = (k) => { try { k ? localStorage.setItem(LS_KEY, k.trim()) : localStorage.removeItem(LS_KEY); } catch {} };
export const hasAccess = () => isDemo() || !!getKey();

export const iso = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const today = () => {
  const t = new URLSearchParams(location.search).get("today");   // nur zum Testen
  return t ? new Date(t + "T12:00:00") : new Date();
};

async function call(path, { method = "GET", query, body } = {}) {
  const url = new URL(`${BASE}/${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + btoa("API_KEY:" + getKey()),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Key ungültig"), { code: "auth" });
  if (!res.ok) throw Object.assign(new Error(`intervals.icu ${res.status}`), { code: "http" });
  return res.status === 204 ? null : res.json();
}

// ---- Demo-Modus: lokale JSON-Dateien aus dem Repo, Schreiben nur im Speicher ----
async function demoJson(file) {
  const r = await fetch(`../${file}`);
  if (!r.ok) throw new Error(`Demo-Datei fehlt: ${file}`);
  return r.json();
}
function demoWrites() { try { return JSON.parse(sessionStorage.getItem(LS_DEMO) || "{}"); } catch { return {}; } }
function saveDemoWrites(w) { try { sessionStorage.setItem(LS_DEMO, JSON.stringify(w)); } catch {} }

async function loadDemo(now) {
  const [athlete, activities, wellness, plan, curves] = await Promise.all([
    demoJson("intervals_athlete.json"),
    demoJson("intervals_activities.json"),
    demoJson("intervals_wellness.json"),
    demoJson("plan_events/B2_2026-11-16_bis_12-06.json"),
    demoJson("app/demo_power_curve.json").catch(() => null),
  ]);
  const w = demoWrites();
  const events = [...plan.events.map((e, i) => ({ id: 900000 + i, ...e, ...(w.events?.[900000 + i] || {}) })), ...Object.values(w.created || {})];
  const t = iso(now);
  const real = [...wellness].reverse().find((d) => d.id <= t && d.sleepSecs && d.restingHR) || {};   // Demo: letzte echten Körperdaten für "heute"
  const well = wellness.filter((d) => d.id <= t).map((d) => ({ ...d, ...(d.id === t && !d.sleepSecs ? { sleepSecs: real.sleepSecs, restingHR: real.restingHR } : {}), ...(w.wellness?.[d.id] || {}) }));
  return { athlete, activities: activities.filter((a) => a.start_date_local), wellness: well, events, curves };
}

// ---- Alles laden, was die App braucht ----
export async function loadAll() {
  const now = today();
  if (isDemo()) return shape(await loadDemo(now), now);
  const oldest = iso(addDays(now, -120));
  const [athlete, activities, wellness, events, curves] = await Promise.all([
    call("athlete/0"),
    call("athlete/0/activities", { query: { oldest, newest: iso(addDays(now, 1)) } }),
    call("athlete/0/wellness", { query: { oldest, newest: iso(now) } }),
    call("athlete/0/events", { query: { oldest: iso(addDays(now, -28)), newest: iso(addDays(now, 42)) } }),
    call("athlete/0/power-curves", { query: { curves: "90d", type: "Ride" } }).catch(() => null),
  ]);
  return shape({ athlete, activities, wellness, events, curves }, now);
}

function shape({ athlete, activities, wellness, events, curves }, now) {
  const ride = (athlete.sportSettings || []).find((s) => (s.types || []).includes("Ride")) || (athlete.sportSettings || [])[0] || {};
  const curve = curves?.list?.[0] || null;
  const best = (secs) => {
    if (!curve) return null;
    const i = curve.secs.indexOf(secs);
    return i >= 0 ? curve.watts[i] : null;
  };
  return {
    now,
    athlete: { id: athlete.id, name: (athlete.firstname || athlete.name || "").replace(/[\d_]+$/, "") || "", weight: athlete.icu_weight || athlete.weight || null,
               ftp: ride.ftp || null, lthr: ride.lthr || null },
    activities: activities
      .filter((a) => a.start_date_local && a.type)
      .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local)),
    wellness: wellness.sort((a, b) => a.id.localeCompare(b.id)),
    events: (events || []).filter((e) => !isBackup(e) && (e.category === "WORKOUT" || e.category === "NOTE" || e.category === "RACE_A" || !e.category))
      .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local)),
    backups: (events || []).filter(isBackup),   // Original-Sicherungen neben einer übernommenen Variante, zählen nicht als Plan
    best: { s5: best(5), m1: best(60), m5: best(300), m20: best(1200), m60: best(3600) },
  };
}


// intervals.icu-Syntax: Wiederholungsblock = Zeile "Nx", danach die Schritte, danach Leerzeile.
// Verschachtelte Wiederholungen gibt es dort nicht, deshalb werden Sätze ausgeschrieben.
export function normalizeWorkout(desc = "") {
  const lines = desc.split("\n"), out = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i].trim(), m = /^(\d+)x$/.exec(l);
    if (!m) { out.push(lines[i]); i++; continue; }
    const block = []; let j = i + 1;
    while (j < lines.length && lines[j].trim().startsWith("- ") && block.length < 2) block.push(lines[j++].trim());
    const inner = block[0] && /^- (\d+)x (\S+) (\S+), (\S+) (\S+)$/.exec(block[0]);
    if (inner) for (let k = 0; k < +m[1]; k++) out.push("", `${inner[1]}x`, `- ${inner[2]} ${inner[3]}`, `- ${inner[4]} ${inner[5]}`, "", ...block.slice(1));
    else out.push("", l, ...block, "");
    i = j;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- Schreiben ----
export async function saveWellness(date, fields) {
  if (isDemo()) {
    const w = demoWrites(); w.wellness = { ...(w.wellness || {}), [date]: { ...(w.wellness?.[date] || {}), ...fields } };
    saveDemoWrites(w); return fields;
  }
  return call(`athlete/0/wellness/${date}`, { method: "PUT", body: { id: date, ...fields } });
}

export async function saveEvent(id, fields) {
  if (fields.description) fields = { ...fields, description: normalizeWorkout(fields.description) };
  if (isDemo()) {
    const w = demoWrites(); w.events = { ...(w.events || {}), [id]: { ...(w.events?.[id] || {}), ...fields } };
    saveDemoWrites(w); return fields;
  }
  return call(`athlete/0/events/${id}`, { method: "PUT", body: fields });
}

// Sicherung des Originals: zweiter Kalender-Eintrag am selben Tag, damit Zwift Variante UND Original bekommt.
export const BACKUP_SUFFIX = "-orig";
export const isBackup = (e) => (e.external_id || "").endsWith(BACKUP_SUFFIX);

export async function createEvent(fields) {
  if (fields.description) fields = { ...fields, description: normalizeWorkout(fields.description) };
  if (isDemo()) {
    const w = demoWrites(), id = 950000 + Object.keys(w.created || {}).length + Math.floor(Math.random() * 1000);
    w.created = { ...(w.created || {}), [id]: { id, ...fields } };
    saveDemoWrites(w); return w.created[id];
  }
  return call("athlete/0/events", { method: "POST", body: fields });
}

export async function deleteEvent(id) {
  if (isDemo()) { const w = demoWrites(); if (w.created) delete w.created[id]; saveDemoWrites(w); return null; }
  return call(`athlete/0/events/${id}`, { method: "DELETE" });
}

// 1-Hz-Daten einer Aktivität für die kurze Bewertung (Demo: streams_<id>.json aus dem Repo)
export async function loadStreams(id) {
  const list = isDemo() ? await demoJson(`streams_${id}.json`) : await call(`activity/${id}/streams.json`, { query: { types: "watts,heartrate" } });
  return Object.fromEntries((list || []).map((s) => [s.type, s.data]));
}

export async function testKey() { const a = await call("athlete/0"); return a.firstname || a.name || a.id; }
