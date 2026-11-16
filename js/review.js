// Kurze Bewertung einer gefahrenen Einheit, ohne KI.
// Verfahren nach docs/auswertung_standard.md: Arbeitsblöcke selbst finden, im Block rechnen
// (Watt, HF, Decoupling über die Blockhälften), nie den Session-Schnitt bewerten.
// Grundlage ist der Kalender-Eintrag, den Fabian gefahren ist (Variante oder Original).

const HR_CAP = { threshold: 177, sst: 174 };      // Winterplan v7.1, Abschnitt "Abbruch / Anpassung"

// ---- Plan lesen: "- 15m 86-89%", Wiederholungen "3x" + Schritte + Leerzeile
export function planSteps(desc = "") {
  const out = []; let rep = 1, inRep = false, buf = [];
  const flush = () => { for (let i = 0; i < rep; i++) out.push(...buf); buf = []; rep = 1; inRep = false; };
  for (const raw of desc.split("\n")) {
    const l = raw.trim(), r = /^(\d+)x$/.exec(l);
    if (r) { flush(); rep = +r[1]; inRep = true; continue; }
    if (l === "") { if (inRep) flush(); continue; }
    const m = /^-\s+(\d+)(m|s)\s+(ramp\s+)?(\d+)(?:-(\d+))?%/.exec(l);
    if (m) { const st = { sec: +m[1] * (m[2] === "m" ? 60 : 1), lo: +m[4], hi: +(m[5] || m[4]), ramp: !!m[3] }; inRep ? buf.push(st) : out.push(st); }
  }
  flush();
  return out;
}

// Art der Bewertung aus den geplanten Schritten, nicht aus dem Namen ("SST 3x10 (statt VO2)" ist SST)
function shape(steps, name = "") {
  if (/test/i.test(name)) return { mode: "test" };
  const blocks = steps.filter((s) => !s.ramp && s.lo >= 76 && s.sec >= 300);
  const reps = steps.filter((s) => !s.ramp && s.lo >= 105 && s.sec <= 120);
  if (reps.length >= 6) return { mode: "reps", reps };
  if (blocks.length) {
    const lo = Math.min(...blocks.map((b) => b.lo));
    return { mode: "blocks", blocks, kind: lo >= 91 ? "threshold" : lo >= 84 ? "sst" : "tempo" };
  }
  return { mode: "easy" };
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function rolling(W, n) { const r = []; let acc = 0; for (let i = 0; i < W.length; i++) { acc += W[i] - (i >= n ? W[i - n] : 0); r.push(acc / Math.min(i + 1, n)); } return r; }
function segments(W, thr, minLen, n = 30) {
  const r = rolling(W, n), out = []; let s = null;
  for (let i = 0; i <= r.length; i++) {
    const on = i < r.length && r[i] >= thr;
    if (on && s == null) s = i;
    if (!on && s != null) {
      let a = Math.max(0, s - n), b = i;                       // Fenster läuft nach: Grenzen auf echte Watt trimmen
      while (a < b && W[a] < thr) a++;
      while (b > a && W[b - 1] < thr) b--;
      if (b - a >= minLen) out.push([a, b]);
      s = null;
    }
  }
  return out;
}
function blockStats(W, H, [a, b]) {
  const w = W.slice(a, b), h = H.slice(a, b).filter(Boolean), half = Math.floor(w.length / 2);
  const ef = (x, y) => { const hy = y.filter(Boolean); return hy.length ? mean(x) / mean(hy) : null; };
  const e1 = ef(w.slice(0, half), H.slice(a, a + half)), e2 = ef(w.slice(half), H.slice(a + half, b));
  return { min: Math.round(w.length / 60), w: Math.round(mean(w)), hr: h.length ? Math.round(mean(h)) : null, hrMax: h.length ? Math.max(...h) : null,
           dec: e1 && e2 ? Math.round(((e1 - e2) / e1) * 1000) / 10 : null };
}
const de1 = (x) => String(x).replace(".", ",");
const tone = (score) => (score >= 85 ? "good" : score >= 70 ? "warn" : "bad");

// ---- Bewertung
export function rate({ act, event, streams, ftp }) {
  const W = (streams.watts || []).map((x) => x || 0), H = streams.heartrate || [];
  if (W.length < 300) return null;
  const steps = planSteps(event?.description || ""), sh = event ? shape(steps, event.name) : { mode: "free" };
  const res = { score: null, tone: "info", headline: "", rows: [], why: [], next: "" };

  if (sh.mode === "test") {
    const r = rolling(W, 1200), best = Math.round(Math.max(...r.slice(1199)));
    const ftpNew = Math.round(best * 0.95);
    res.tone = "good"; res.headline = `20 min: ${best} W → FTP ${ftpNew} W`;
    res.next = ftpNew !== ftp ? `FTP in intervals.icu und in Zwift auf ${ftpNew} W setzen. Kalender und App rechnen dann neu.` : "FTP bestätigt. Nichts zu ändern.";
    return res;
  }

  if (sh.mode === "blocks") {
    const target = sh.blocks.map((b) => ({ lo: Math.round((ftp * b.lo) / 100), hi: Math.round((ftp * b.hi) / 100), sec: b.sec }));
    const thr = Math.min(...target.map((t) => t.lo)) - 15, minLen = Math.min(...target.map((t) => t.sec)) * 0.6;
    const found = segments(W, thr, minLen).slice(0, target.length).map((s) => blockStats(W, H, s));
    const outdoorGroup = !found.length && act.type !== "VirtualRide" && /gruppe/i.test(event.name);
    if (outdoorGroup) return easy(res, { W, H, act, steps, event, ftp, group: true });
    let score = 100; const lo = target[0].lo, hi = target[0].hi, cap = HR_CAP[sh.kind];
    const miss = target.length - found.length;
    if (miss) { score -= 20 * miss; res.why.push(`${miss} Block${miss > 1 ? "e" : ""} fehlt`); }
    const low = found.reduce((s, b, i) => s + Math.max(0, target[i].lo - 5 - b.w), 0);
    if (low) { score -= Math.min(25, low * 1.5); res.why.push(`Watt unter Ziel (${found.map((b) => b.w).join(" · ")} W, Ziel ${lo}–${hi})`); }
    const decMax = Math.max(...found.map((b) => b.dec ?? 0));
    if (decMax > 5) { score -= (decMax - 5) * 3; res.why.push(`Decoupling bis ${de1(decMax)} %`); }
    const hrOver = cap ? Math.max(0, ...found.map((b) => (b.hr || 0) - cap)) : 0;
    if (hrOver) { score -= hrOver * 2; res.why.push(`Puls über dem Deckel ${cap}`); }
    const drop = found.length > 1 ? found[0].w - found[found.length - 1].w : 0;
    if (drop > 8) { score -= drop - 8; res.why.push(`letzter Block ${drop} W unter dem ersten`); }
    res.score = Math.max(0, Math.round(score)); res.tone = tone(res.score);
    res.headline = `${found.length} von ${target.length} Blöcken · ${found.length ? Math.round(mean(found.map((b) => b.w))) : "–"} W (Ziel ${lo}–${hi})${found.length ? ` · Decoupling max ${de1(decMax)} %` : ""}`;
    res.rows = found.map((b, i) => ({ k: `Block ${i + 1}`, v: `${b.min} min · ${b.w} W · HF ${b.hr ?? "–"}${b.hrMax ? ` (max ${b.hrMax})` : ""} · ${b.dec != null ? de1(b.dec) + " %" : "–"}` }));
    res.next = miss || low > 10 ? "Stufe wiederholen, nicht steigern."
      : decMax > 8 ? "Block war für heute zu lang. Nächstes Mal gleich lang, Pausen nicht kürzen, mehr trinken."
      : hrOver ? "Watt passten, Puls hoch. Nächstes Mal unten im Zielbereich starten und Kühlung prüfen."
      : drop > 8 ? "Hinten raus eingebrochen. Nächstes Mal am unteren Ende starten."
      : "Getroffen. Nächste Stufe laut Plan.";
    return res;
  }

  if (sh.mode === "reps") {
    const tgt = Math.round((ftp * sh.reps[0].lo) / 100), len = sh.reps[0].sec;
    // Öffner im Warm-up (z. B. 30 s @ 109 %) zählen nicht: nur Wiederholungen ab 90 % der Zielwatt
    const reps = segments(W, tgt * 0.85, len * 0.6, 3).filter(([a, b]) => b - a <= len * 2 + 5 && mean(W.slice(a + 2, b)) >= tgt * 0.9);
    const sets = [];
    reps.forEach(([a, b], i) => { if (!i || a - reps[i - 1][1] > 60) sets.push([]); sets[sets.length - 1].push(mean(W.slice(a + 2, b))); });
    const avg = Math.round(mean(reps.map(([a, b]) => mean(W.slice(a + 2, b)))) || 0);
    const setAvg = sets.map((s) => Math.round(mean(s)));
    const fade = setAvg.length > 1 ? Math.round(((setAvg[0] - setAvg[setAvg.length - 1]) / setAvg[0]) * 1000) / 10 : 0;
    let score = 100; const miss = Math.max(0, sh.reps.length - reps.length);
    if (miss) { score -= Math.min(30, miss * 1.5); res.why.push(`${reps.length} von ${sh.reps.length} Wiederholungen`); }
    const under = avg ? Math.round(((tgt - avg) / tgt) * 1000) / 10 : 100;
    if (under > 5) { score -= (under - 5) * 3; res.why.push(`Schnitt ${avg} W, ${de1(under)} % unter Ziel`); }
    if (fade > 5) { score -= 10; res.why.push(`letzter Satz ${de1(fade)} % unter dem ersten`); }
    res.score = Math.max(0, Math.round(score)); res.tone = tone(res.score);
    res.headline = `${reps.length} von ${sh.reps.length} Wiederholungen · ${avg || "–"} W (Ziel ~${tgt})`;
    res.rows = setAvg.map((w, i) => ({ k: `Satz ${i + 1}`, v: `${sets[i].length} Wdh · ${w} W` }));
    res.next = fade > 5 ? "Hinten raus abgefallen: nächste VO2-Einheit −10 W oder nach 2 Sätzen aufhören."
      : under > 5 || miss > 3 ? "Ziel nicht erreicht: gleiche Einheit mit −10 W wiederholen."
      : "VO2 sitzt. Nächstes Mal gleiche Watt.";
    return res;
  }

  return easy(res, { W, H, act, steps, event, ftp, free: sh.mode === "free" });
}

// Lockere Fahrt: HF-Deckel ist die Steuergröße (Winterplan: "HF-Deckel gilt vor Watt")
function easy(res, { W, H, act, steps, event, ftp, group, free }) {
  const m = /HF(?:-Deckel| ≤)\s*(\d{3})/.exec(event?.description || ""), cap = m ? +m[1] : 140;
  const h = H.filter(Boolean), over = h.length ? Math.round((h.filter((x) => x > cap).length / h.length) * 100) : null;
  const hr = h.length ? Math.round(mean(h)) : null, np = act.icu_weighted_avg_watts;
  if (group || free) {
    res.headline = `${group ? "Gruppe" : "Ohne Plan"} · ${Math.round((act.moving_time || 0) / 60)} min · Load ${act.icu_training_load ?? "–"}${np ? ` · NP ${np} W` : ""}${hr ? ` · HF ${hr}` : ""}`;
    res.next = group ? "Zählt als Q2. Bei mehr als 250 Load: Q1 nächste Woche nur mit frischen Beinen." : "";
    return res;
  }
  const main = steps.filter((s) => !s.ramp).sort((a, b) => b.sec - a.sec)[0];
  let score = 100;
  if (over != null && over > 5) { score -= Math.min(40, (over - 5) * 2); res.why.push(`${over} % der Zeit über HF ${cap}`); }
  const hiW = main ? Math.round((ftp * main.hi) / 100) : null;
  const avgW = Math.round(mean(W.filter((x) => x > 0)) || 0);
  if (hiW && avgW > hiW + 10) { score -= 10; res.why.push(`Schnitt ${avgW} W über dem Zielbereich`); }
  res.score = Math.max(0, Math.round(score)); res.tone = tone(res.score);
  res.headline = `Locker: HF ${hr ?? "–"} (Deckel ${cap})${over != null ? ` · ${over} % darüber` : ""} · ${avgW} W`;
  res.next = res.score >= 85 ? "Locker geblieben. Genau so." : "Zu oft über dem Deckel. Watt runter, sobald die HF steigt.";
  return res;
}
