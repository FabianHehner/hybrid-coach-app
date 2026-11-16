import * as api from "./api.js";
import { iso, addDays } from "./api.js";
import { classify, KIND, readiness, decide, weekContext, scoreWord } from "./rules.js";
import { pack, unpack, strip, planOf } from "./marker.js";
import { affirmation } from "./affirmations.js";
import { radar, line, bars, ring } from "./charts.js";
import { coachNote, getAiKey, setAiKey } from "./ai.js";
import { GOAL, BLOCKS } from "./config.js";
import { rate } from "./review.js";

const $ = (s, r = document) => r.querySelector(s);
const view = $("#view"), tabs = $("#tabs"), sheet = $("#sheet"), sheetBody = $("#sheet-body"), sheetEl = $("#sheet .sheet");
const CI_MIN = [45, 60, 75, 90];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const de = (n, d = 0) => (n == null || isNaN(n) ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtDate = (s, o = { day: "2-digit", month: "2-digit" }) => new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("de-DE", o);
const dayDiff = (a, b) => Math.round((new Date(a.slice(0, 10) + "T12:00:00") - new Date(b.slice(0, 10) + "T12:00:00")) / 864e5);
const ls = { get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

const S = { data: null, tab: "today", salt: 0, ai: null, aiBusy: false, sel: null, open: new Set(), rate: {} };

const ICON = {
  bike: '<svg viewBox="0 0 24 24"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l4 8M9 5h3"/></svg>',
  gym: '<svg viewBox="0 0 24 24"><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>',
  miss: '<svg viewBox="0 0 24 24"><path d="M7 12h10"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.300M20 4v4h-4M20 12a8 8 0 0 1-14 5.300M4 20v-4h4"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 5-8 4 5"/></svg>',
};

// Original-Sicherung: zweiter Kalender-Eintrag neben einer übernommenen Variante, damit Zwift beide Einheiten bekommt.
const backupOn = (day) => S.data.backups.find((b) => b.start_date_local.slice(0, 10) === day);
function dropBackup(b) { S.data.backups = S.data.backups.filter((x) => x !== b); return api.deleteEvent(b.id).catch(() => {}); }
// Aufräumen: Der Tag ist vorbei oder die Fahrt ist da → die Sicherung hat ihren Zweck erfüllt.
function tidyBackups() {
  const d = S.data, t = iso(d.now);
  for (const b of [...d.backups]) {
    const day = b.start_date_local.slice(0, 10);
    if (day < t || d.activities.some((a) => a.start_date_local.slice(0, 10) === day && /Ride/.test(a.type || ""))) dropBackup(b);
  }
}

// ---------------------------------------------------------------- Kurze Bewertung nach der Fahrt
// Gefahren wurde, was im Kalender stand: gepaarter Eintrag (auch eine Original-Sicherung), sonst die Rad-Einheit des Tages.
function eventFor(a) {
  const d = S.data, day = a.start_date_local.slice(0, 10), ride = /Ride/.test(a.type || "");
  return [...d.events, ...d.backups].find((e) => e.id === a.paired_event_id)
    || d.events.find((e) => e.start_date_local.slice(0, 10) === day && e.category === "WORKOUT" && /Ride/.test(e.type || "") === ride) || null;
}
const RATE_V = 1;
function rateHtml(a, ftp, rerender) {
  if (!/Ride/.test(a.type || "")) return "";
  const key = `hc.rate.v${RATE_V}.${a.id}`;
  let r = S.rate[a.id] ?? ls.get(key);
  if (r === undefined || r === null) {
    if (!S.rate[a.id]) {
      S.rate[a.id] = "loading";
      api.loadStreams(a.id).then((st) => {
        const ev = eventFor(a);
        const res = rate({ act: a, event: ev ? { ...ev, description: strip(ev.description || "") } : null, streams: st, ftp }) || "none";
        S.rate[a.id] = res; if (res !== "none") ls.set(key, res);
      }).catch(() => { S.rate[a.id] = "none"; }).finally(() => { const y = window.scrollY; rerender(); window.scrollTo(0, y); });
    }
    r = "loading";
  }
  if (r === "loading") return `<div class="rate"><p class="hint">Bewerte die Einheit …</p></div>`;
  if (r === "none") return "";
  return `<div class="rate tone-${r.tone}">
    <div class="rate-head">${r.score != null ? `<b class="rate-score">${r.score}</b>` : ""}<div><div class="eyebrow">Kurze Bewertung</div><div class="rate-line">${esc(r.headline)}</div></div></div>
    ${r.rows.length ? `<ul class="rate-rows">${r.rows.map((x) => `<li><span>${esc(x.k)}</span><span>${esc(x.v)}</span></li>`).join("")}</ul>` : ""}
    ${r.why.length ? `<p class="rate-why">Abzug: ${esc(r.why.join(" · "))}</p>` : ""}
    ${r.next ? `<p class="rate-next">${esc(r.next)}</p>` : ""}</div>`;
}

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }

// ---------------------------------------------------------------- Ableitungen
function derive() {
  const d = S.data, t = iso(d.now);
  const well = d.wellness, wToday = well.find((w) => w.id === t) || well[well.length - 1] || {};
  const ctl = wToday.ctl ?? null, atl = wToday.atl ?? null;
  const eftp = [...well].reverse().map((w) => w.sportInfo?.[0]?.eftp).find((x) => x) || null;
  const ftp = d.athlete.ftp || Math.round(eftp) || 300;
  const acts = d.activities;
  const actsOn = (day) => acts.filter((a) => a.start_date_local.slice(0, 10) === day);
  const evsOn = (day) => d.events.filter((e) => e.start_date_local.slice(0, 10) === day && e.category !== "NOTE");
  const isRide = (x) => /Ride/.test(x.type || "");
  const matchDone = (ev) => actsOn(ev.start_date_local.slice(0, 10)).find((a) => a.paired_event_id === ev.id || (isRide(a) === isRide(ev) && (isRide(ev) || a.type === ev.type)));
  // Wochen in Folge mit mindestens 4 Einheiten
  let streak = 0;
  for (let i = 1; i <= 26; i++) {
    const mon = addDays(mondayOf(d.now), -7 * i), n = acts.filter((a) => { const x = a.start_date_local.slice(0, 10); return x >= iso(mon) && x <= iso(addDays(mon, 6)); }).length;
    if (n >= 4) streak++; else break;
  }
  const lastGym = [...acts].reverse().find((a) => a.type === "WeightTraining");
  const hoursSinceGym = lastGym ? (d.now - new Date(lastGym.start_date_local)) / 36e5 : null;
  return { t, well, wToday, ctl, atl, tsb: ctl != null && atl != null ? ctl - atl : null, eftp, ftp, acts, actsOn, evsOn, matchDone, streak, hoursSinceGym,
    daysToRace: dayDiff(GOAL.race.date, t) };
}
function mondayOf(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(12, 0, 0, 0); return x; }

// Workout-Beschreibung in Hinweistext und Schritte teilen
function parseDesc(desc = "") {
  const lines = strip(desc).split("\n"), note = [], steps = [];
  let inRep = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^\d+x$/i.test(l)) { steps.push({ rep: l.replace(/x$/i, "") + " ×" }); inRep = true; continue; }
    if (l.startsWith("- ")) {
      const m = /^-\s+(?:(\d+)x\s+)?(.+?)\s+(\S+(?:,\s*.+)?)$/.exec(l) || [];
      const body = l.slice(2);
      const parts = body.split(/\s+/);
      steps.push({ dur: parts[0], target: parts.slice(1).join(" "), inRep });
      continue;
    }
    if (l === "") { if (steps.length) inRep = false; continue; }
    if (!steps.length) note.push(l);
  }
  return { note: note.join("\n"), steps };
}
const W5 = (x) => Math.round(x / 5) * 5;
const prettyTarget = (t, ftp) => t.replace(/ramp /, "")
  .replace(/(\d+)(?:-(\d+))?%/g, (_, a, b) => (ftp ? `${W5((a * ftp) / 100)}${b ? "–" + W5((b * ftp) / 100) : ""} W` : `${a}${b ? "–" + b : ""} %`))
  .replace(/(\d)w\b/g, "$1 W").replace(/-/g, "–").replace(/,\s*/g, " · ");
const prettyDur = (d) => d.replace(/(\d+)m$/, "$1 min").replace(/(\d+)s$/, "$1 s").replace(/^(\d+)x$/, "$1 ×");

// ---------------------------------------------------------------- Start / Laden
async function boot() {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  tabs.addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) go(b.dataset.tab); });
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  dragToClose();
  if (!api.hasAccess()) return renderStart();
  await load();
}
async function load() {
  view.innerHTML = `<div class="loading"><div><div class="pulse"></div>Hole deine Daten …</div></div>`;
  try {
    S.data = await api.loadAll();
    tidyBackups();
    tabs.hidden = false;
    render();
  } catch (e) {
    tabs.hidden = true;
    if (e.code === "auth") { api.setKey(""); return renderStart("Der Key wurde von intervals.icu abgelehnt. Bitte neu eingeben."); }
    view.innerHTML = `<div class="start"><h1>Keine Verbindung</h1><p class="lead">${esc(e.message)}. Prüf dein Netz und versuch es nochmal.</p><button class="btn" id="retry">Nochmal versuchen</button></div>`;
    $("#retry").onclick = load;
  }
}
function go(tab) { S.tab = tab; [...tabs.children].forEach((b) => b.classList.toggle("on", b.dataset.tab === tab)); render(); window.scrollTo({ top: 0 }); }
function render() { ({ today: renderToday, plan: renderPlan, progress: renderProgress, more: renderMore })[S.tab](); }

function renderStart(err) {
  tabs.hidden = true;
  view.innerHTML = `<div class="start">
    <div class="mark">${ICON.mark}</div>
    <h1>Dein Training.<br>Jeden Tag passend.</h1>
    <p class="lead">Verbinde die App einmal mit intervals.icu. Der Key bleibt nur auf diesem Gerät.</p>
    <div class="card">
      <div class="field" style="margin-top:0"><label for="k">intervals.icu API-Key</label>
        <input id="k" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="aus Settings → Developer Settings">
        <div class="hint">Du findest ihn in intervals.icu unter Settings, ganz unten bei „Developer Settings“.</div></div>
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      <div class="btn-row"><button class="btn" id="connect">Verbinden</button></div>
    </div></div>`;
  $("#connect").onclick = async () => {
    const k = $("#k").value.trim(); if (!k) return;
    $("#connect").disabled = true; $("#connect").textContent = "Prüfe …";
    api.setKey(k);
    try { await api.testKey(); await load(); } catch (e) { api.setKey(""); renderStart(e.code === "auth" ? "Dieser Key funktioniert nicht." : "intervals.icu ist gerade nicht erreichbar."); }
  };
}

// ---------------------------------------------------------------- Heute
const CI_LABEL = {
  fatigue: ["Frisch", "Normal", "Müde", "Platt"],
  soreness: ["Locker", "Normal", "Schwer", "Sehr schwer"],
  stress: ["Ruhig", "Normal", "Stressig", "Sehr stressig"],
  motivation: ["Richtig Lust", "Passt", "Wenig", "Gar keine"],
};
const TAGS = { plus: "Mehr", go: "Plan", easier: "Leichter", z2: "Locker", upper: "Nur Upper", rest: "Frei" };
const CI_Q = [["fatigue", "Müdigkeit", "Wie müde bist du?"], ["soreness", "Beine", "Wie fühlen sich die Beine an?"], ["stress", "Stress", "Wie war der Tag?"], ["motivation", "Lust", "Wie viel Lust hast du?"]];

function countUp(root = view) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0), pre = el.dataset.pre || "";
    if (isNaN(to) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now(), dur = 700;
    const tick = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = pre + de(to * e, dec); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

function stepsHtml(desc, ftp) {
  const p = parseDesc(desc);
  return `${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}${p.steps.length ? `<ul class="steps">${p.steps.map((s) => s.rep ? `<li class="rep"><span>${esc(s.rep)}</span><span></span></li>` : `<li class="${s.inRep ? "in" : ""}"><span>${esc(prettyDur(s.dur))}</span><span>${esc(prettyTarget(s.target, ftp))}</span></li>`).join("")}</ul>` : ""}`;
}

function renderToday() {
  const D = derive(), d = S.data;
  const evs = D.evsOn(D.t), done = D.actsOn(D.t);
  const ev = evs.find((e) => !D.matchDone(e)) || null;
  const checkin = ls.get(`hc.checkin.${D.t}`);
  const ready = readiness({ wellness: D.well, checkin, date: D.t });
  const mark = ev ? unpack(ev.description) : null;                    // gesetzt, wenn eine Variante im Kalender steht
  const orig = mark?.orig || null;
  const plan = ev ? planOf(ev) : null;                                // immer die ursprünglich geplante Einheit
  const wk = plan ? weekContext({ now: d.now, date: D.t, acts: D.acts, events: d.events, wellness: D.well }) : null;
  const dec = plan && checkin ? decide({ event: plan, ready, checkin, ftp: D.ftp, ctx: wk }) : null;
  const opts = dec?.options || null;
  const choice = ev ? (mark ? { level: mark.level } : ls.get(`hc.choice.${D.t}`)) : null;   // {level} sobald entschieden
  const selLevel = choice?.level || S.sel || opts?.find((o) => o.recommended).level;
  const sel = opts?.find((o) => o.level === selLevel) || opts?.find((o) => o.recommended) || null;
  const kind = plan ? classify(plan) : null, meta = kind ? KIND[kind] : null;

  const h = d.now.getHours(), greet = h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend";
  const ctx = !ev ? (done.length ? "done" : "rest") : sel?.level === "plus" ? "plus" : sel && ["easier", "z2", "upper", "rest"].includes(sel.level) ? "low" : kind === "test" ? "test" : !meta.ride ? "gym" : meta.key ? "key" : "easy";
  const text = affirmation({ context: ctx, date: D.t, salt: S.salt, vars: { ctl: D.ctl ? Math.round(D.ctl) : null, days: D.daysToRace, ftp: D.ftp, gap: GOAL.ftp - D.ftp, streak: D.streak } });

  const sleepH = D.wToday.sleepSecs ? D.wToday.sleepSecs / 3600 : null;
  const tone = { sleep: sleepH == null ? "none" : sleepH < 6 ? "bad" : sleepH < 7 ? "warn" : "good",
    rhr: ready.rhr == null ? "none" : ready.rhr > 55 ? "bad" : ready.rhrBase && ready.rhr - ready.rhrBase >= 5 ? "warn" : "good",
    tsb: D.tsb == null ? "none" : D.tsb < -30 ? "bad" : D.tsb < -20 ? "warn" : "good" };
  const num = (v, dec = 0, pre = "") => (v == null ? "–" : `<span data-count="${v}" data-dec="${dec}" data-pre="${pre}">${pre}${de(v, dec)}</span>`);

  let html = `${api.isDemo() ? `<div class="demo-flag">Demo · es wird nichts in intervals.icu geschrieben</div>` : ""}
  <header class="hello"><div><div class="date">${esc(d.now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))}</div>
    <h1>${greet}${d.athlete.name ? ", " + esc(d.athlete.name.split(" ")[0]) : ""}</h1></div>
    <span class="chip"><b>${D.daysToRace}</b> Tage bis Köln</span></header>
  <section class="card affirm"><div class="waves" aria-hidden="true"></div><p>${esc(text)}</p><div class="row"><small>Für heute</small>
    <button id="again" aria-label="Anderer Satz">${ICON.spark}</button></div></section>
  <div class="vitals">
    <div class="vital"><div class="k"><i class="dot ${tone.sleep}"></i>Schlaf</div><div class="v">${num(sleepH, 1)}<small>h</small></div></div>
    <div class="vital"><div class="k"><i class="dot ${tone.rhr}"></i>Ruhepuls</div><div class="v">${num(ready.rhr)}</div></div>
    <div class="vital"><div class="k"><i class="dot ${tone.tsb}"></i>Form</div><div class="v">${D.tsb != null ? num(Math.round(D.tsb), 0, D.tsb > 0 ? "+" : "") : "–"}</div></div>
    <div class="vital"><div class="k"><i class="dot none"></i>Fitness</div><div class="v">${num(D.ctl ? Math.round(D.ctl) : null)}</div></div>
  </div>`;

  // --- Check-in: immer sichtbar, zeigt Eingaben und wie sie einfließen ---
  if (!checkin) {
    html += `<section class="card checkin-cta"><div class="cc-text"><h3>Wie geht es dir heute?</h3>
      <p>Müdigkeit, Beine, Stress, Lust und dein Zeitbudget. Vier Taps, daraus werden drei passende Varianten.</p></div>
      <button class="btn" id="checkin">Check-in starten</button></section>`;
  } else {
    html += `<section class="card tone-${ready.score >= 75 ? "good" : ready.score >= 55 ? "warn" : "bad"}"><div class="verdict"><div id="ring"></div>
      <div><div class="eyebrow">Dein Check-in</div>
        <div class="ci-chips">${CI_Q.map(([k, short]) => `<span class="ci-chip v${checkin[k]}"><i></i>${esc(short)}: ${esc(CI_LABEL[k][checkin[k] - 1])}</span>`).join("")}
          ${checkin.minutes ? `<span class="ci-chip"><i></i>Zeit: ${checkin.minutes} min</span>` : ""}</div>
        <button class="link" id="checkin">Ändern</button></div></div>
      <details class="calc"><summary>So rechnet die App</summary>
        <div class="calc-row head"><span>Start</span><b>100</b></div>
        ${ready.parts.map((p) => `<div class="calc-row"><span><em>${esc(p.source)}</em>${esc(p.label)}</span><b class="${p.delta < 0 ? "neg" : p.delta > 0 ? "pos" : ""}">${p.delta > 0 ? "+" : ""}${p.delta === 0 ? "±0" : p.delta}</b></div>`).join("")}
        <div class="calc-row head"><span>Bereitschaft</span><b>${ready.score}</b></div>
        <p class="hint">Ab 75 gilt der Plan, darunter schlägt die App eine leichtere Variante vor. Schlaf unter 6 h oder Ruhepuls über 55 streichen Intervalle unabhängig vom Score. Dazu prüft die App die Woche: 48 h zwischen schwerem Lower und Key, nur eine harte Einheit in 48 h, kein „Mehr“ in Entlastungswochen. Der Check-in wird in intervals.icu gespeichert.</p></details>
    </section>`;
  }

  for (const a of done) {
    html += `<section class="card session"><span class="badge done">Erledigt</span>
      <h3>${esc(a.name || "Einheit")}</h3>
      <div class="meta">${Math.round((a.moving_time || 0) / 60)} min${a.icu_training_load ? ` · Load ${a.icu_training_load}` : ""}${a.icu_weighted_avg_watts ? ` · NP ${a.icu_weighted_avg_watts} W` : ""}${a.average_heartrate ? ` · HF ${Math.round(a.average_heartrate)}` : ""}</div>
      ${rateHtml(a, D.ftp, renderToday)}</section>`;
  }

  if (ev) {
    const badge = `<span class="badge ${meta.ride ? (meta.key ? "key" : "") : "gym"}">${esc(meta.label)}</span>`;
    if (opts) {
      html += `<h2 class="sec">Deine Einheit · drei Varianten</h2><div class="opts3 ${choice ? "locked" : ""}" role="radiogroup" aria-label="Variante wählen">
        ${opts.map((o) => { const min = o.adjusted ? Math.round((o.adjusted.moving_time || 0) / 60) : Math.round((plan.moving_time || 0) / 60);
          return `<button class="opt3 lv-${o.level}" role="radio" aria-checked="${o.level === sel.level}" data-level="${o.level}" ${choice ? "disabled" : ""}>
            <span class="o-top"><span class="o-tag">${esc(o.tag)}</span>${o.recommended ? `<span class="o-rec">Empfohlen</span>` : ""}</span>
            <span class="o-name">${esc(o.adjusted?.name || plan.name)}</span>
            <span class="o-min">${min ? min + " min" : "frei"}</span></button>`; }).join("")}</div>`;
    }
    if (dec?.notes.length) html += `<section class="card weeklogic"><div class="eyebrow">Blick auf die Woche</div><ul>${dec.notes.map((n) => `<li class="${n.tone}">${esc(n.text)}</li>`).join("")}</ul></section>`;
    const shown = mark ? { ...ev, description: strip(ev.description) } : sel?.adjusted ? { ...plan, ...sel.adjusted } : plan;
    html += `<section class="card session">
      ${badge}${sel ? `<span class="badge tag lv-${choice?.level || sel.level}">${esc(TAGS[choice?.level] || sel.tag)}</span>` : ""}
      <h3>${esc(shown.name)}</h3>
      <div class="meta">${shown.moving_time ? Math.round(shown.moving_time / 60) + " min" : "frei"}${!sel?.adjusted && plan.icu_training_load ? ` · Load ~${plan.icu_training_load}` : ""}</div>
      ${sel && (!choice || choice.level === sel.level) ? `<p class="why">${esc(sel.why)}</p>` : ""}
      ${S.ai ? `<div class="ai"><div class="lbl">Coach-Einschätzung</div>${esc(S.ai)}</div>` : ""}
      ${stepsHtml(shown.description, D.ftp)}
      ${choice && backupOn(D.t) ? `<p class="hint">In Zwift liegen im Ordner „Intervals.icu“ ${choice.level === "rest" ? "weiterhin die geplante Einheit als" : "beide: diese Variante und"} „${esc(backupOn(D.t).name)}“. Du entscheidest beim Start.</p>` : ""}
      <div class="btn-row">${
        choice ? `<button class="btn ghost" id="undo">Andere Variante wählen</button>`
        : !sel ? `<p class="hint center">Mit dem Check-in bekommst du drei Varianten: Plan, eine leichtere und, wenn der Tag passt, eine mit mehr.</p>`
        : `<button class="btn" id="choose">${sel.adjusted ? "Diese Variante übernehmen" : "So mache ich es"}</button>
           ${getAiKey() && !S.ai ? `<button class="btn ghost" id="ai" ${S.aiBusy ? "disabled" : ""}>${S.aiBusy ? "Coach denkt nach …" : "Coach-Einschätzung holen"}</button>` : ""}`}
      </div></section>`;
  } else if (!done.length) {
    const next = d.events.find((e) => e.start_date_local.slice(0, 10) > D.t && e.category !== "NOTE");
    html += `<section class="card session"><span class="badge rest">Frei</span><h3>Heute lädst du auf</h3>
      <p class="note">${next ? `Weiter geht es ${esc(fmtDate(next.start_date_local, { weekday: "long" }))} mit „${esc(next.name)}“.` : "Erholung ist Teil des Plans."}</p></section>`;
  }
  view.innerHTML = html;
  countUp();

  if (checkin) ring($("#ring"), ready.score, scoreWord(ready.score));
  $("#again").onclick = () => { S.salt++; renderToday(); };
  const ci = $("#checkin"); if (ci) ci.onclick = () => openCheckin(D.t, checkin);
  view.querySelectorAll(".opt3").forEach((b) => (b.onclick = () => { S.sel = b.dataset.level; S.ai = null; const y = window.scrollY; renderToday(); window.scrollTo(0, y); }));
  const ch = $("#choose"); if (ch) ch.onclick = () => chooseOption(ev, plan, sel, D.t);
  const un = $("#undo"); if (un) un.onclick = () => undoChoice(ev, orig, D.t);
  const ai = $("#ai"); if (ai) ai.onclick = () => askCoach({ D, plan, opts, sel, ready, checkin });
}

function openCheckin(date, prev) {
  const v = { fatigue: null, soreness: null, stress: null, motivation: null, minutes: null, ...(prev || {}) };
  if (!CI_MIN.includes(v.minutes)) v.minutes = null;
  sheetBody.innerHTML = `<h2 id="sheet-title">Wie geht es dir?</h2><p class="sub">Vier Taps. Daraus werden dein Score und drei Varianten für heute.</p>
    ${CI_Q.map(([k, , q]) => `<div class="q"><div class="ql">${q}</div><div class="opts" data-k="${k}">${CI_LABEL[k].map((t, i) => `<button class="opt" data-v="${i + 1}" aria-pressed="${v[k] === i + 1}">${t}</button>`).join("")}</div></div>`).join("")}
    <div class="q"><div class="ql">Wie viel Zeit hast du heute? <span>optional</span></div><div class="opts time" data-k="minutes">
      ${[[null, "Wie geplant"], ...CI_MIN.map((m) => [m, `${m} min`])].map(([m, t]) => `<button class="opt" data-v="${m ?? ""}" aria-pressed="${v.minutes === m}">${t}</button>`).join("")}</div></div>
    <div class="btn-row"><button class="btn" id="ci-go" disabled>Auswerten</button><button class="btn quiet" data-close>Abbrechen</button></div>`;
  sheetBody.scrollTop = 0;
  const upd = () => { $("#ci-go").disabled = !CI_Q.every(([k]) => v[k]); };
  sheetBody.querySelectorAll(".opts").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest(".opt"); if (!b) return;
    const k = g.dataset.k; v[k] = b.dataset.v === "" ? null : +b.dataset.v;
    g.querySelectorAll(".opt").forEach((x) => x.setAttribute("aria-pressed", x === b));
    upd();
  }));
  upd();
  $("#ci-go").onclick = async () => {
    ls.set(`hc.checkin.${date}`, v); S.ai = null; S.sel = null;
    closeSheet(); renderToday(); window.scrollTo({ top: 0, behavior: "smooth" });
    try { await api.saveWellness(date, { fatigue: v.fatigue, soreness: v.soreness, stress: v.stress, motivation: v.motivation }); }
    catch { toast("Check-in lokal gespeichert, intervals.icu war nicht erreichbar."); }
  };
  sheet.hidden = false;
}
function closeSheet() { sheet.hidden = true; sheetEl.style.transform = ""; }
// Sheet am Kopf nach unten ziehen schließt es
function dragToClose() {
  const head = $("#sheet-head"); let y0 = null, dy = 0;
  head.addEventListener("pointerdown", (e) => { if (e.target.closest("[data-close]")) return; y0 = e.clientY; dy = 0; sheetEl.classList.add("drag"); head.setPointerCapture(e.pointerId); });
  head.addEventListener("pointermove", (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheetEl.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; y0 = null; sheetEl.classList.remove("drag"); if (dy > 70) closeSheet(); else sheetEl.style.transform = ""; };
  head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
}

async function chooseOption(ev, plan, sel, date) {
  const btn = $("#choose");
  if (sel.adjusted) {
    btn.disabled = true; btn.textContent = "Schreibe in den Kalender …";
    const orig = { name: plan.name, description: plan.description, moving_time: plan.moving_time, icu_training_load: plan.icu_training_load ?? null };
    const fields = { ...sel.adjusted, description: pack(`${sel.adjusted.description}\n\nVariante „${sel.tag}“ per Check-in am ${fmtDate(date)} (geplant: ${plan.name}).`, sel.level, orig) };
    try { const saved = await api.saveEvent(ev.id, fields); Object.assign(ev, fields, saved?.description ? { description: saved.description } : {}); }
    catch (e) { toast("Konnte nicht speichern: " + e.message); btn.disabled = false; btn.textContent = "Diese Variante übernehmen"; return; }
    // Rad-Einheit: das Original bleibt als zweiter Eintrag im Kalender, so landen Variante und Original in Zwift
    if (/Ride/.test(ev.type || "") && !backupOn(date)) {
      try {
        S.data.backups.push(await api.createEvent({ category: "WORKOUT", start_date_local: ev.start_date_local, type: ev.type, indoor: ev.indoor ?? true,
          name: `Original · ${orig.name}`, moving_time: orig.moving_time, external_id: `${ev.external_id || "hc-" + date}${api.BACKUP_SUFFIX}`,
          description: `Ursprünglicher Plan, zur Auswahl neben der Variante „${sel.tag}“. Die App räumt diesen Eintrag nach der Fahrt weg.\n\n${strip(orig.description || "")}` }));
      } catch { ls.set(`hc.choice.${date}`, { level: sel.level }); toast("Variante steht im Kalender. Das Original konnte nicht zusätzlich gesichert werden."); return renderToday(); }
    }
  }
  ls.set(`hc.choice.${date}`, { level: sel.level });
  toast(!sel.adjusted ? "Entschieden. Viel Erfolg." : backupOn(date) ? "Übernommen. Variante und Original gehen an Zwift." : "Übernommen. Steht so in intervals.icu.");
  renderToday();
}
async function undoChoice(ev, orig, date) {
  try {
    if (orig) { await api.saveEvent(ev.id, orig); Object.assign(ev, orig); }
    const b = backupOn(date); if (b) await dropBackup(b);
    ls.del(`hc.choice.${date}`); S.sel = null; renderToday();
  } catch (e) { toast("Konnte nicht zurücksetzen: " + e.message); }
}
async function askCoach({ D, plan, opts, sel, ready, checkin }) {
  S.aiBusy = true; renderToday();
  const recent = D.acts.slice(-6).map((a) => ({ datum: a.start_date_local.slice(0, 10), name: a.name, typ: a.type, min: Math.round((a.moving_time || 0) / 60), load: a.icu_training_load, np: a.icu_weighted_avg_watts }));
  try {
    S.ai = await coachNote({ heute: D.t, ftp: D.ftp, geplant: { name: plan.name, min: Math.round((plan.moving_time || 0) / 60), beschreibung: plan.description },
      checkin_1_gut_4_schlecht: checkin, bereitschaft: ready.score, rechnung: ready.parts.map((p) => `${p.label}: ${p.delta}`),
      varianten: opts.map((o) => ({ stufe: o.tag, name: o.adjusted?.name || plan.name, empfohlen_von_regeln: o.recommended })), gewaehlt: sel.tag,
      koerper: { schlaf_h: ready.sleepH, ruhepuls: ready.rhr, ruhepuls_schnitt: ready.rhrBase, ctl: D.ctl, atl: D.atl, tsb: D.tsb }, letzte_einheiten: recent });
  } catch (e) { toast(e.message); }
  S.aiBusy = false; renderToday();
}

// ---------------------------------------------------------------- Plan
function renderPlan() {
  const D = derive(), d = S.data;
  const ms = GOAL.milestones.filter((m) => m.date >= D.t);
  let html = `<header class="hello"><div><div class="date">Ausblick</div><h1>Dein Weg nach Köln</h1></div></header>
    ${phaseHtml(D)}
    <div class="miles">${ms.map((m, i) => `<div class="mile ${i === 0 ? "next" : ""}"><div class="n">${dayDiff(m.date, D.t)}<small>Tage</small></div>
      <div class="t">${esc(m.label)}</div><div class="d">${fmtDate(m.date, { day: "numeric", month: "short" })} · ${esc(m.note)}</div></div>`).join("")}</div>`;
  const mon0 = mondayOf(d.now);
  for (let w = 0; w < 4; w++) {
    const mon = addDays(mon0, 7 * w), days = [...Array(7)].map((_, i) => iso(addDays(mon, i)));
    const evs = d.events.filter((e) => days.includes(e.start_date_local.slice(0, 10)) && e.category !== "NOTE");
    const acts = D.acts.filter((a) => days.includes(a.start_date_local.slice(0, 10)));
    if (!evs.length && !acts.length && w > 0) continue;
    const planned = evs.reduce((s, e) => s + (e.icu_training_load || 0), 0), doneLoad = acts.reduce((s, a) => s + (a.icu_training_load || 0), 0);
    const kw = isoWeek(mon), total = Math.max(planned, doneLoad, 1);
    html += `<section class="card week"><div class="week-head"><b>${w === 0 ? "Diese Woche" : w === 1 ? "Nächste Woche" : "KW " + kw}</b>
      <span>${fmtDate(days[0])}–${fmtDate(days[6])} · ${w === 0 ? `${Math.round(doneLoad)} / ` : ""}${Math.round(planned) || "–"} Load</span></div>
      ${w === 0 && planned ? `<div class="bar"><i style="width:${Math.min(100, (doneLoad / total) * 100)}%"></i></div>` : ""}`;
    for (const day of days) {
      const de_ = evs.filter((e) => e.start_date_local.slice(0, 10) === day), da = acts.filter((a) => a.start_date_local.slice(0, 10) === day);
      const usedActs = new Set(); let rows = "";
      for (const e of de_) {
        const k = classify(planOf(e)), meta = KIND[k], a = D.matchDone(e); if (a) usedActs.add(a.id);
        const missed = !a && day < D.t, open = S.open.has(e.id);
        rows += `<button class="item ${a ? "done" : missed ? "missed" : meta.ride ? (meta.key ? "key" : "") : "gym"}" data-ev="${esc(e.id)}" aria-expanded="${open}">
          <span class="ico">${a ? ICON.check : missed ? ICON.miss : meta.ride ? ICON.bike : ICON.gym}</span>
          <span class="nm">${esc(e.name)}</span><span class="mn">${a ? `Load ${a.icu_training_load ?? "–"}` : e.moving_time ? Math.round(e.moving_time / 60) + " min" : ""}</span></button>
          ${open ? `<div class="detail">${a && /Ride/.test(a.type || "") ? rateHtml(a, D.ftp, renderPlan) : esc(parseDesc(e.description).note || e.description || "")}</div>` : ""}`;
      }
      for (const a of da.filter((x) => !usedActs.has(x.id))) {
        rows += `<div class="item done"><span class="ico">${ICON.check}</span><span class="nm">${esc(a.name || a.type)}</span><span class="mn">Load ${a.icu_training_load ?? "–"}</span></div>`;
      }
      const dt = new Date(day + "T12:00:00");
      html += `<div class="day ${day === D.t ? "today" : day < D.t ? "past" : ""}"><div class="wd">${dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "")}<b>${dt.getDate()}</b></div>
        <div>${rows || `<div class="free">${day < D.t ? "–" : "Frei"}</div>`}</div></div>`;
    }
    html += `</section>`;
  }
  if (!d.events.length) html += `<section class="card"><h3 class="ct">Noch kein Plan im Kalender</h3><p class="cs">Geplante Workouts aus intervals.icu erscheinen hier automatisch.</p></section>`;
  view.innerHTML = html;
  view.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { const id = isNaN(+b.dataset.ev) ? b.dataset.ev : +b.dataset.ev; S.open.has(id) ? S.open.delete(id) : S.open.add(id); const y = window.scrollY; renderPlan(); window.scrollTo(0, y); }));
}
// Planphase: aktueller Block aus config.js, Woche im Block, Soll/Ist der laufenden Woche aus Kalender und Aktivitäten
function phaseHtml(D) {
  const t = D.t, cur = BLOCKS.find((b) => t >= b.from && t <= b.to), b = cur || BLOCKS.find((x) => x.from > t);
  if (!b) return "";
  const weeks = Math.round((dayDiff(b.to, b.from) + 1) / 7), wk = cur ? Math.floor(dayDiff(t, b.from) / 7) + 1 : 0;
  const deload = cur && b.deload && t >= b.deload;
  const mon = iso(mondayOf(S.data.now)), sun = iso(addDays(mondayOf(S.data.now), 6));
  const inWk = (x) => { const d = x.start_date_local.slice(0, 10); return d >= mon && d <= sun; };
  const isR = (x) => /Ride/.test(x.type || "");
  const evs = S.data.events.filter((e) => inWk(e) && e.category === "WORKOUT"), acts = D.acts.filter(inWk);
  const sum = (xs, f) => xs.reduce((s, x) => s + (x[f] || 0), 0);
  const hm = (sec) => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
  const first = BLOCKS[0].from, last = BLOCKS[BLOCKS.length - 1].to, pos = Math.max(0, Math.min(100, (dayDiff(t, first) / dayDiff(last, first)) * 100));
  return `<section class="card phase">
    <div class="eyebrow">${cur ? `Block ${b.n} · Woche ${wk} von ${weeks}${deload ? " · Entlastung" : ""}` : `Nächster Block · Start ${esc(fmtDate(b.from, { weekday: "short", day: "numeric", month: "short" }))}`}</div>
    <h3 class="ct">${esc(b.name)}</h3><p class="cs">${esc(b.focus)}</p>
    <div class="tl" aria-hidden="true">${BLOCKS.map((x) => `<i class="${x === b ? "on" : x.to < t ? "past" : ""}" style="flex:${dayDiff(x.to, x.from) + 1}"></i>`).join("")}<b style="left:${pos}%"></b></div>
    <div class="tl-l"><span>${esc(fmtDate(first, { day: "numeric", month: "short" }))}</span><span>Köln ${esc(fmtDate(GOAL.race.date, { day: "numeric", month: "short" }))}</span></div>
    <div class="tiles">
      <div class="tile"><div class="k">Rad Woche</div><div class="v">${hm(sum(acts.filter(isR), "moving_time"))}<small> / ${hm(sum(evs.filter(isR), "moving_time"))}</small></div></div>
      <div class="tile"><div class="k">Rad-Load</div><div class="v">${Math.round(sum(acts.filter(isR), "icu_training_load"))}<small> / ${Math.round(sum(evs.filter(isR), "icu_training_load"))}</small></div></div>
      <div class="tile"><div class="k">Gym</div><div class="v">${acts.filter((a) => a.type === "WeightTraining").length}<small> / ${evs.filter((e) => !isR(e)).length}</small></div></div></div>
    <p class="hint">${[`Pro Woche im Block: ${esc(b.hours)} Rad, ${esc(b.tss)} Rad-TSS`, b.deload && `Entlastung ab ${fmtDate(b.deload)}`, b.test && `FTP-Test ${fmtDate(b.test)}`].filter(Boolean).join(" · ")}</p>
  </section>`;
}
function isoWeek(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); }

// ---------------------------------------------------------------- Fortschritt
function renderProgress() {
  const D = derive(), d = S.data, b = d.best, kg = d.athlete.weight || GOAL.weight;
  const gap = GOAL.ftp - D.ftp;
  // Balance-Achsen
  const last = (n) => D.well.filter((w) => w.id <= D.t).slice(-n);
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
  const sleep14 = avg(last(14).map((w) => (w.sleepSecs ? w.sleepSecs / 3600 : null))), rhr14 = avg(last(14).map((w) => w.restingHR));
  const d28 = iso(addDays(d.now, -28)), a28 = D.acts.filter((a) => a.start_date_local.slice(0, 10) > d28);
  const zt = { low: 0, all: 0 };
  a28.forEach((a) => (a.icu_zone_times || []).forEach((z) => { if (/^Z[1-7]$/.test(z.id)) { zt.all += z.secs; if (z.id === "Z1" || z.id === "Z2") zt.low += z.secs; } }));
  const z2share = zt.all ? zt.low / zt.all : null, gym28 = a28.filter((a) => a.type === "WeightTraining").length, perWeek = a28.length / 4;
  const ratio = b.m20 && b.m5 ? b.m20 / b.m5 : null;
  const rec = sleep14 && rhr14 ? 0.6 * Math.min(1, sleep14 / 7.5) + 0.4 * Math.min(1, 50 / rhr14) : null;

  view.innerHTML = `<header class="hello"><div><div class="date">Fortschritt</div><h1>Wo du stehst</h1></div></header>
    <section class="card"><div class="hero"><div><div class="cs" style="margin:0 0 6px">FTP heute</div><div class="big">${D.ftp}<small>W</small></div></div>
      <div class="goal">Ziel<b>${GOAL.ftp} W</b>${de(GOAL.ftp / GOAL.weight, 1)} W/kg</div></div>
      <div class="tiles"><div class="tile"><div class="k">W/kg</div><div class="v">${de(D.ftp / kg, 2)}</div></div>
        <div class="tile"><div class="k">Noch</div><div class="v">${gap > 0 ? gap + " W" : "geschafft"}</div></div>
        <div class="tile"><div class="k">eFTP</div><div class="v">${D.eftp ? Math.round(D.eftp) : "–"}</div></div></div>
      <div class="chart" id="c-ftp"></div>
      <div class="legend"><span><i></i>eFTP (intervals.icu)</span><span><i class="t"></i>Zielpfad</span></div></section>

    <section class="card"><h3 class="ct">Fahrerprofil</h3><p class="cs">Beste Leistung der letzten 90 Tage gegen das Profil, das zu ${GOAL.ftp} W passt. Äußerer Ring = Ziel.</p>
      <div class="chart" id="c-profile"></div><div id="t-profile"></div></section>

    <section class="card"><h3 class="ct">Balance</h3><p class="cs">Was die Leistung trägt, letzte 4 Wochen. Äußerer Ring = Zielbereich.</p>
      <div class="chart" id="c-balance"></div><div id="t-balance"></div></section>

    <section class="card"><h3 class="ct">Fitness (CTL)</h3><p class="cs">Letzte 12 Wochen. Ab Dezember soll die Linie um 1–2 pro Woche steigen.</p><div class="chart" id="c-ctl"></div></section>
    <section class="card"><h3 class="ct">Wochen-Load</h3><p class="cs">Rad und Gym zusammen. ${D.streak >= 2 ? `${D.streak} Wochen in Folge mit mindestens 4 Einheiten.` : ""}</p><div class="chart" id="c-load"></div></section>`;

  // FTP-Pfad
  const eftpPts = D.well.filter((w) => w.id <= D.t && w.sportInfo?.[0]?.eftp).slice(-90).map((w) => ({ x: new Date(w.id + "T12:00:00"), y: Math.round(w.sportInfo[0].eftp * 10) / 10 }));
  if (eftpPts.length > 1) line($("#c-ftp"), eftpPts, { title: "eFTP-Verlauf und Zielpfad", unit: " W", yMin: 280, yMax: 340,
    marks: [{ x: new Date(D.t + "T12:00:00"), y: D.ftp }, ...GOAL.milestones.filter((m) => m.date > D.t).map((m) => ({ x: new Date(m.date + "T12:00:00"), y: m.ftp }))] });

  const P = GOAL.profile;
  const prof = [["Sprint 5 s", b.s5, P.s5], ["1 min", b.m1, P.m1], ["5 min", b.m5, P.m5], ["20 min", b.m20, P.m20], ["60 min", b.m60, P.m60]]
    .map(([label, v, t]) => ({ label, value: v ? v / t : 0, short: v ? `${v} W` : "–", detail: v ? `${v} W von ${t} W (${Math.round((v / t) * 100)} %) · ${de(v / kg, 2)} W/kg` : "keine Daten", ist: v, ziel: t }));
  radar($("#c-profile"), prof, { title: "Fahrerprofil" });
  $("#t-profile").innerHTML = table(prof.map((p) => [p.label, p.ist ? `${p.ist} W` : "–", `${p.ziel} W`, p.ist ? Math.round(p.value * 100) + " %" : "–"]), ["Dauer", "Ist", "Ziel", "Anteil"]);

  const bal = [
    ["Fitness", D.ctl ? D.ctl / GOAL.ctl : 0, D.ctl ? `CTL ${Math.round(D.ctl)}` : "–", `CTL ${D.ctl ? Math.round(D.ctl) : "–"} von ${GOAL.ctl}`],
    ["Schwelle", ratio ? ratio / 0.88 : 0, ratio ? de(ratio, 2) : "–", `20 min / 5 min = ${ratio ? de(ratio, 2) : "–"}, Ziel 0,88`],
    ["Locker-Anteil", z2share != null ? z2share / 0.75 : 0, z2share != null ? Math.round(z2share * 100) + " %" : "–", `${z2share != null ? Math.round(z2share * 100) : "–"} % der Radzeit in Z1/Z2, Ziel 75 %`],
    ["Erholung", rec ?? 0, sleep14 ? de(sleep14, 1) + " h" : "–", `Schlaf Ø ${sleep14 ? de(sleep14, 1) : "–"} h, Ruhepuls Ø ${rhr14 ? Math.round(rhr14) : "–"}`],
    ["Kraft", gym28 / 8, `${gym28}×`, `${gym28} Gym-Einheiten in 4 Wochen, Ziel 8`],
    ["Konstanz", perWeek / 5, de(perWeek, 1) + "/Wo", `${de(perWeek, 1)} Einheiten pro Woche, Ziel 5`],
  ].map(([label, value, short, detail]) => ({ label, value, short, detail }));
  radar($("#c-balance"), bal, { title: "Balance" });
  $("#t-balance").innerHTML = table(bal.map((x) => [x.label, x.detail, Math.round(Math.min(1.1, x.value) * 100) + " %"]), ["Bereich", "Wert", "Anteil"]);

  const ctlPts = D.well.filter((w) => w.id <= D.t && w.ctl != null).slice(-84).map((w) => ({ x: new Date(w.id + "T12:00:00"), y: w.ctl }));
  if (ctlPts.length > 1) line($("#c-ctl"), ctlPts, { title: "CTL-Verlauf" });

  const wk = []; const mon0 = mondayOf(d.now);
  for (let i = 9; i >= 0; i--) {
    const mon = addDays(mon0, -7 * i), a = iso(mon), z = iso(addDays(mon, 6));
    const xs = D.acts.filter((x) => { const s = x.start_date_local.slice(0, 10); return s >= a && s <= z; });
    wk.push({ label: fmtDate(a), value: xs.reduce((s, x) => s + (x.icu_training_load || 0), 0), sub: `Woche ab ${fmtDate(a)} · ${xs.length} Einheiten`, current: i === 0 });
  }
  bars($("#c-load"), wk, { title: "Wochen-Load", ref: D.ctl ? Math.round((D.ctl * 7) / 10) * 10 : null });
}
const table = (rows, head) => `<details class="tbl"><summary>Als Tabelle</summary><table><tbody><tr>${head.map((h) => `<td><b>${esc(h)}</b></td>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;

// ---------------------------------------------------------------- Mehr
function renderMore() {
  const D = derive(), d = S.data, ai = getAiKey();
  view.innerHTML = `<header class="hello"><div><div class="date">Einstellungen</div><h1>Mehr</h1></div></header>
    <section class="card"><h3 class="ct">Verbindung</h3>
      <div class="kv"><span>intervals.icu</span><b>${api.isDemo() ? "Demo-Daten" : "verbunden"}</b></div>
      <div class="kv"><span>Athlet</span><b>${esc(d.athlete.name || d.athlete.id)}</b></div>
      <div class="kv"><span>FTP · Gewicht</span><b>${D.ftp} W · ${de(d.athlete.weight, 1)} kg</b></div>
      <div class="kv"><span>Daten bis</span><b>${esc(fmtDate(D.well[D.well.length - 1]?.id || D.t, { day: "2-digit", month: "2-digit", year: "numeric" }))}</b></div>
      <div class="btn-row two"><button class="btn ghost" id="reload">Neu laden</button><button class="btn ghost" id="logout">Key löschen</button></div></section>
    <section class="card"><h3 class="ct">Coach-Einschätzung (KI)</h3><p class="cs">Optional. Die Regeln entscheiden immer selbst. Mit einem Anthropic-Key kommentiert Claude die Entscheidung in ein paar Sätzen.</p>
      <div class="field"><label for="aik">Anthropic API-Key</label><input id="aik" type="password" autocomplete="off" placeholder="${ai ? "gespeichert · zum Ändern neu eingeben" : "sk-ant-…"}"></div>
      <div class="hint">Bleibt nur auf diesem Gerät. Kosten pro Einschätzung: deutlich unter einem Cent.</div>
      <div class="btn-row two"><button class="btn ghost" id="aisave">Speichern</button><button class="btn ghost" id="aidel" ${ai ? "" : "disabled"}>Entfernen</button></div></section>
    <section class="card"><h3 class="ct">Ziel</h3>
      <div class="kv"><span>FTP-Ziel</span><b>${GOAL.ftp} W · ${de(GOAL.ftp / GOAL.weight, 1)} W/kg</b></div>
      <div class="kv"><span>${esc(GOAL.race.name)}</span><b>${esc(fmtDate(GOAL.race.date, { day: "2-digit", month: "2-digit", year: "numeric" }))}</b></div>
      <p class="hint">Ziele und Meilensteine kommen aus dem Winterplan. intervals.icu bleibt die Quelle für alle Trainingsdaten.</p></section>`;
  $("#reload").onclick = load;
  $("#logout").onclick = () => { if (confirm("Key von diesem Gerät löschen?")) { api.setKey(""); S.data = null; renderStart(); } };
  $("#aisave").onclick = () => { const k = $("#aik").value.trim(); if (!k) return; setAiKey(k); toast("KI-Key gespeichert."); renderMore(); };
  $("#aidel").onclick = () => { setAiKey(""); S.ai = null; toast("KI-Key entfernt."); renderMore(); };
}

boot();
