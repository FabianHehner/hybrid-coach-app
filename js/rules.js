// Auto-Regulation ohne KI: feste Regeln aus Winterplan v7.0 und Gymplan v3.4.
// 1) readiness(): Tageszustand → Score 0–100, jede Zeile offen ausgewiesen.
// 2) weekContext(): was vorher war und was als Nächstes kommt (48-h-Abstände, Entlastung, Ramp).
// 3) decide(): Standard-Variante + zwei Alternativen + Hinweise zur Wochenlogik.
// Grundlagen: subjektives Befinden reagiert verlässlicher auf Last als Einzelwerte der Uhr
// (Saw et al. 2016), HRV zählt als 7-Tage-Trend gegen die eigene Basis (Plews et al. 2013),
// Explosiv- und Key-Leistung leidet nach schwerem Lower bis ~48 h.
import { unpack, planOf } from "./marker.js";

export const KIND = {
  vo2: { label: "VO2", key: true, ride: true },
  threshold: { label: "Schwelle", key: true, ride: true },
  test: { label: "Test", key: true, ride: true },
  sst: { label: "Sweet Spot", key: true, ride: true },
  long: { label: "Q2", key: true, ride: true },
  fatmax: { label: "Fatmax", key: false, ride: true },
  z2: { label: "Z2", key: false, ride: true },
  opener: { label: "Opener", key: false, ride: true },
  gymA: { label: "Gym A", key: false, ride: false },
  gymB: { label: "Gym B", key: false, ride: false },
  other: { label: "Einheit", key: false, ride: true },
};

export function classify(ev) {
  const n = (ev.name || "").toLowerCase();
  if (/gym\s*a/.test(n)) return "gymA";
  if (/gym\s*b/.test(n)) return "gymB";
  if (ev.type === "WeightTraining") return "gymA";
  if (/test/.test(n)) return "test";
  if (/vo2|30\/15|40\/20/.test(n)) return "vo2";
  if (/schwelle|threshold/.test(n)) return "threshold";
  if (/gruppe|long|q2/.test(n)) return "long";
  if (/sst|sweet/.test(n)) return "sst";
  if (/fatmax/.test(n)) return "fatmax";
  if (/opener/.test(n)) return "opener";
  if (/z2|lit|locker|easy|recovery/.test(n)) return "z2";
  return "other";
}

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);
const fmt = (x) => x.toFixed(1).replace(".", ",");
const W = (x) => Math.round(x / 5) * 5;
const isRide = (x) => /Ride/.test(x.type || "");
const dayOf = (x) => x.start_date_local.slice(0, 10);
const shift = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const diffDays = (a, b) => Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 864e5);
const mondayOf = (s) => shift(s, -((new Date(s + "T12:00:00").getDay() + 6) % 7));

// Harte Rad-Einheit: Intervalle (IF ≥ 80 %, mind. 40 min) oder sehr viel Last
const hardRide = (a) => isRide(a) && (((a.icu_intensity || 0) >= 80 && (a.moving_time || 0) >= 2400) || (a.icu_training_load || 0) >= 130);

// Gym A (schwerer Lower) oder B? Erst der Plan des Tages, dann der Name aus Hevy.
export function gymType(a, events = []) {
  const ev = events.find((e) => dayOf(e) === dayOf(a) && e.type === "WeightTraining");
  if (ev) return classify(planOf(ev)) === "gymB" ? "B" : "A";
  const n = (a.name || "").toLowerCase();
  if (/^\s*b\s*·|gym\s*b|we edition|upper/.test(n)) return "B";
  if (/^\s*a\s*·|gym\s*a|fullbody|lower/.test(n)) return "A";
  return null;
}

// ---- Wochenlogik: was war, was kommt ----
export function weekContext({ now, date, acts, events, wellness }) {
  const past = acts.filter((a) => dayOf(a) <= date), mon = mondayOf(date);
  const hrs = (a) => (now - new Date(a.start_date_local)) / 36e5;
  const lastA = [...past].reverse().find((a) => a.type === "WeightTraining" && gymType(a, events) === "A");
  const yest = shift(date, -1);
  const hardYesterday = past.find((a) => dayOf(a) === yest && hardRide(a)) || null;
  const bigRide = [...past].reverse().find((a) => isRide(a) && (a.icu_training_load || 0) >= 250 && dayOf(a) < date && dayOf(a) >= shift(date, -3)) || null;
  const plans = events.filter((e) => e.category !== "NOTE").map((e) => { const p = planOf(e); return { ev: e, plan: p, day: dayOf(e), kind: classify(p), mark: unpack(e.description) }; })
    .sort((a, b) => a.day.localeCompare(b.day));
  const nextKey = plans.find((p) => p.day > date && KIND[p.kind].key) || null;
  const week = plans.filter((p) => p.day >= mon && p.day <= shift(mon, 6));
  const prevQ1 = plans.filter((p) => p.day < date && (p.kind === "vo2" || p.kind === "threshold")).slice(-2);
  const w = wellness.filter((x) => x.id <= date);
  const rhr3 = w.filter((x) => x.restingHR != null).slice(-3);
  return {
    hoursSinceA: lastA ? hrs(lastA) : null,
    hardYesterday, bigRide,
    nextKey, keyInDays: nextKey ? diffDays(nextKey.day, date) : null,
    deload: week.some((p) => /deload|entlastung|test/i.test(p.plan.name || "")),
    qualityDone: past.filter((a) => dayOf(a) >= mon && dayOf(a) < date && hardRide(a)).length,
    ramp: (w[w.length - 1] || {}).rampRate ?? null,
    rhr3High: rhr3.length === 3 && rhr3.every((x) => x.restingHR > 54),
    q1Missed: prevQ1.length === 2 && prevQ1.every((p) => p.mark && ["easier", "z2", "rest"].includes(p.mark.level)),
  };
}

// ---- Tageszustand → Score ----
export function readiness({ wellness, checkin, date }) {
  const w = wellness.filter((x) => !date || x.id <= date);
  const last = w[w.length - 1] || {};
  const todayW = date ? w.find((x) => x.id === date) || {} : last;
  const prevW = date ? w.find((x) => x.id === shift(date, -1)) || {} : {};
  const base = w.filter((x) => x.id !== todayW.id).slice(-28);
  const rhrBase = median(base.map((d) => d.restingHR));
  const sleepH = todayW.sleepSecs ? todayW.sleepSecs / 3600 : null;
  const prevSleep = prevW.sleepSecs ? prevW.sleepSecs / 3600 : null;
  const rhr = todayW.restingHR ?? null;
  const tsb = last.ctl != null && last.atl != null ? last.ctl - last.atl : null;

  const parts = [], hard = [];
  const add = (source, label, delta, tone) => parts.push({ source, label, delta, tone: tone || (delta <= -15 ? "bad" : delta < 0 ? "warn" : "good") });

  if (sleepH == null && rhr == null) add("Uhr", "Noch keine Schlaf- und Pulsdaten von heute. Der Score stützt sich auf deinen Check-in", 0, "none");
  if (sleepH != null) {
    if (sleepH < 6) { hard.push("sleep"); add("Uhr", `Schlaf ${fmt(sleepH)} h (unter 6 h: keine Intervalle)`, -30); }
    else if (sleepH < 7) add("Uhr", `Schlaf ${fmt(sleepH)} h, etwas kurz`, -10);
    else add("Uhr", `Schlaf ${fmt(sleepH)} h`, 0);
    if (sleepH >= 6 && prevSleep != null && (sleepH + prevSleep) / 2 < 6.5) add("Uhr", `Zweite kurze Nacht in Folge (Ø ${fmt((sleepH + prevSleep) / 2)} h)`, -5);
  }
  if (rhr != null) {
    const delta = rhrBase != null ? rhr - rhrBase : 0;
    if (rhr > 55) { hard.push("rhr"); add("Uhr", `Ruhepuls ${rhr} (über 55: nur Z2 oder frei)`, -30); }
    else if (delta >= 5) add("Uhr", `Ruhepuls ${rhr}, ${delta} über deinem Schnitt`, -12);
    else add("Uhr", `Ruhepuls ${rhr}${rhrBase != null ? `, Schnitt ${rhrBase}` : ""}`, 0);
  }
  // HRV: nur gegen die eigene Basis und mit kleinem Gewicht (SDNN der Uhr streut stark)
  const hv = base.map((d) => d.hrvSDNN).filter((x) => x != null), h = todayW.hrvSDNN ?? null;
  if (h != null && hv.length >= 10) {
    const m = mean(hv), sd = Math.sqrt(mean(hv.map((x) => (x - m) ** 2)));
    const h7 = mean([...w.slice(-7).map((d) => d.hrvSDNN).filter((x) => x != null)]);
    const low = h < m - sd, trend = h7 != null && h7 < m - 0.5 * sd;
    if (low && trend) add("Uhr", `HRV ${Math.round(h)}, heute und im 7-Tage-Trend unter deinem Schnitt ${Math.round(m)}`, -12);
    else if (trend) add("Uhr", `HRV-Trend der Woche unter deinem Schnitt ${Math.round(m)}`, -8);
    else if (low) add("Uhr", `HRV ${Math.round(h)}, klar unter deinem Schnitt ${Math.round(m)}`, -5);
    else add("Uhr", `HRV ${Math.round(h)}, Schnitt ${Math.round(m)}`, 0);
  }
  if (tsb != null) {
    if (tsb < -30) add("Training", `Form ${Math.round(tsb)}: viel Ermüdung im System`, -15);
    else if (tsb < -20) add("Training", `Form ${Math.round(tsb)}: spürbar vorbelastet`, -5);
    else add("Training", `Form ${tsb > 0 ? "+" : ""}${Math.round(tsb)}`, 0);
  }
  if (checkin) {
    const pen = { fatigue: [0, 0, -15, -30], soreness: [0, 0, -15, -30], stress: [0, 0, -10, -20], motivation: [0, 0, -5, -10] };
    const txt = {
      fatigue: ["Frisch", "Normal wach", "Müde", "Platt"],
      soreness: ["Beine locker", "Beine normal", "Beine schwer", "Beine sehr schwer"],
      stress: ["Ruhiger Tag", "Normaler Tag", "Stressiger Tag", "Sehr stressiger Tag"],
      motivation: ["Richtig Lust", "Lust passt", "Wenig Lust", "Gar keine Lust"],
    };
    let fresh = 0;
    for (const k of Object.keys(pen)) {
      const v = checkin[k]; if (!v) continue;
      if (v === 1) fresh++;
      add("Du", txt[k][v - 1], pen[k][v - 1], v === 1 ? "good" : undefined);
    }
    if (checkin.soreness === 4) hard.push("soreness");
    if (fresh >= 3) add("Du", "Rundum frisch", +5, "good");
  }
  const score = Math.max(0, Math.min(100, Math.round(100 + parts.reduce((s, p) => s + p.delta, 0))));
  return { score, parts, hard, sleepH, rhr, rhrBase, tsb };
}

// Stufen von defensiv nach offensiv.
const LADDER = {
  key: ["rest", "z2", "easier", "go", "plus"],
  easy: ["rest", "easier", "go", "plus"],
  gym: ["rest", "upper", "easier", "go", "plus"],
};
const TAG = { plus: "Mehr", go: "Plan", easier: "Leichter", z2: "Locker", upper: "Nur Upper", rest: "Frei" };

function baseLevel({ kind, meta, ready }) {
  const s = ready.score, hard = ready.hard;
  if (!meta.ride) {
    if (s < 30) return "rest";
    if (hard.length || s < 55) return "upper";
    return s < 75 ? "easier" : "go";
  }
  if (meta.key) {
    if (hard.length) return "z2";
    if (kind === "test") return s >= 75 && (ready.rhr == null || ready.rhr <= 52) && (ready.sleepH == null || ready.sleepH >= 7) ? "go" : "z2";   // Test nur frisch
    return s >= 75 ? "go" : s >= 55 ? "easier" : s >= 35 ? "z2" : "rest";
  }
  return s >= 50 && !hard.includes("rhr") ? "go" : s >= 30 ? "easier" : "rest";
}

// Liefert { options: [3 Varianten, offensiv → defensiv], notes: [Hinweise zur Wochenlogik] }.
export function decide({ event, ready, checkin, ftp, ctx }) {
  const kind = classify(event), meta = KIND[kind];
  const ladder = LADDER[!meta.ride ? "gym" : meta.key ? "key" : "easy"];
  const sore = checkin?.soreness || 2, c = ctx || {};
  const notes = [], note = (text, tone = "warn") => notes.push({ text, tone });
  let base = baseLevel({ kind, meta, ready }), block = null;
  const cap = (lvl, text) => { if (ladder.indexOf(base) > ladder.indexOf(lvl)) { base = lvl; note(text); return true; } return false; };
  const h = c.hoursSinceA != null ? Math.round(c.hoursSinceA) : null;

  if (meta.ride && meta.key && kind !== "test") {
    // Schwerer Lower < 48 h vor der Key (10./11.11.: < 24 h, Schwelle mit HF bis 180)
    // Standard ist Di-Abend → Do-Abend (~47 h). Die Regel greift erst, wenn nur eine Nacht dazwischen liegt.
    if (h != null && h < 36 && sore >= 2) cap("easier", `Schwerer Lower vor ${h} h. Mit weniger als zwei Nächten Abstand verliert die Key an Qualität, deshalb heute eine Stufe leichter.`) || note(`Schwerer Lower vor ${h} h. Regel: 48 h Abstand zur Key.`);
    else if (h != null && h < 36) { note(`Schwerer Lower vor ${h} h. Die Beine fühlen sich locker an, deshalb bleibt der Plan. Obergrenzen streng halten.`, "info"); block = "der schwere Lower liegt erst eine Nacht zurück"; }
    if (c.hardYesterday) {
      const txt = `Gestern war hart („${c.hardYesterday.name}“).`;
      if (sore >= 3) cap("easier", `${txt} Mit schweren Beinen keine zweite harte Einheit in 48 h.`); else note(`${txt} Regel: nur eine Maximaleinheit in 48 h. Bricht die 2. Wiederholung ein, aufhören.`);
      block = block || "gestern war schon hart";
    }
    if (c.bigRide && (kind === "vo2" || kind === "threshold") && sore >= 3) cap("easier", `Große Fahrt am ${c.bigRide.start_date_local.slice(8, 10)}.${c.bigRide.start_date_local.slice(5, 7)}. (Load ${Math.round(c.bigRide.icu_training_load)}) und schwere Beine: Sweet Spot statt ${meta.label}.`);
    if (c.q1Missed && (kind === "vo2" || kind === "threshold")) cap("easier", "Die letzten zwei Key-Einheiten liefen reduziert. Heute bewusst Sweet Spot, damit du wieder eine saubere Einheit triffst.");
    if (c.qualityDone >= 2) { note(`Diese Woche stehen schon ${c.qualityDone} harte Einheiten. Mehr als zwei bringen selten mehr.`); block = block || "schon zwei harte Einheiten diese Woche"; }
  }
  if (kind === "test" && base !== "go" && !ready.hard.length) note("Ein Test lohnt nur frisch: Ruhepuls bis 52, mind. 7 h Schlaf, Score ab 75. Sonst morgen.", "info");
  if (kind === "gymA") {
    if (c.keyInDays === 1) cap("easier", `Morgen steht „${c.nextKey.plan.name}“ an. Unter 48 h davor nur das Top-Set, Back-offs streichen.`) || (block = "morgen ist Key");
    if (c.hardYesterday && sore >= 3) cap("easier", "Gestern lange oder hart gefahren und schwere Beine: Top-Set halten, Back-offs streichen.");
    else if (c.hardYesterday) block = block || "gestern war eine harte Rad-Einheit";
  }
  if (kind === "gymB" && c.keyInDays === 1) cap("upper", `Morgen steht „${c.nextKey.plan.name}“ an: Lower heute weglassen.`) || (block = "morgen ist Key");
  if (meta.ride && !meta.key) {
    if (c.rhr3High) cap("easier", "Ruhepuls seit 3 Tagen über 54: Last-Bremse, heute kurz und locker.");
    if (c.keyInDays === 1) block = `morgen steht „${c.nextKey.plan.name}“ an`;
  }
  // Nach oben: nur an guten Tagen und wenn die Woche es hergibt
  if (c.deload) block = "Entlastungswoche";
  else if (ready.tsb != null && ready.tsb < -25) block = block || `Form ${Math.round(ready.tsb)}`;
  else if (c.ramp != null && c.ramp > 4) block = block || `Fitness steigt schon um ${fmt(c.ramp)} pro Woche`;
  // "Mehr" braucht mindestens 5 min über Plan: wer genau die Planzeit angibt, bekommt kein "Mehr"
  const budgetShort = checkin?.minutes && checkin.minutes < Math.round((event.moving_time || 0) / 60) + 5;
  // "Mehr" nur an wirklich guten Tagen: Score ab 85, nicht müde, Beine nicht schwer, volle Zeit
  const dayOk = !ready.hard.length && ready.score >= 85 && (checkin?.fatigue || 2) <= 2 && sore <= 2 && !budgetShort && base === "go" && kind !== "test" && kind !== "opener";
  const plusOk = dayOk && !block;
  if (dayOk && block) note(`Kein „Mehr“ heute: ${block}.`, "info");

  const usable = ladder.filter((l) => l === base || ((l !== "plus" || plusOk) && !(kind === "test" && (l === "easier" || l === "plus"))));
  const i = usable.indexOf(base), pick = [];
  for (const j of [i + 1, i - 1, i + 2, i - 2, i + 3, i - 3]) if (usable[j] && pick.length < 2) pick.push(usable[j]);
  const bctx = { event, kind, meta, checkin, ftp };
  const options = [base, ...pick].sort((x, y) => ladder.indexOf(y) - ladder.indexOf(x)).map((l) => ({ ...build(l, bctx), recommended: l === base }));
  return { options, notes };
}

// Watt in der Beschreibung immer in % FTP: passt sich an, wenn der FTP in intervals.icu steigt.
function build(level, { event, kind, meta, checkin, ftp }) {
  const planMin = Math.round((event.moving_time || 3600) / 60);
  const budget = checkin?.minutes || null;
  const m = /(\d+)\s*x\s*(\d+)/.exec(event.name || "");
  const reps = m ? +m[1] : 3, dur = m ? +m[2] : 12;
  const out = { kind, level, tag: TAG[level], headline: "", why: "", adjusted: null };
  const wr = (lo, hi) => `${W(ftp * lo / 100)}–${W(ftp * hi / 100)} W`;
  const z2Text = (min) => `HF-Deckel 135. Watt sind heute egal.\n\n- ${min}m 55-64%`;
  const head = event.name.split("·")[0].trim();
  const vo = /40\/20/.test(event.name || "") ? { on: "40s", off: "20s", p: 125, name: "40/20" } : { on: "30s", off: "15s", p: 129, name: "30/15" };
  const voSets = (sets, n) => `${sets}x\n- ${n}x ${vo.on} ${vo.p}%, ${vo.off} 50%\n- 3m 45%`;

  if (level === "go") {
    out.headline = "Wie geplant";
    out.why = meta.key ? "Du bist bereit. Zieh es durch und halt die Obergrenzen." : meta.ride ? "Passt. Locker bleiben, HF-Deckel halten." : "Passt. Saubere Sätze, RPE-Deckel 8,5.";
    if (budget && budget < planMin - 5 && meta.ride) {
      const short = shorten({ kind, reps, dur, budget, event, wr, vo, voSets });
      if (short) { out.adjusted = short; out.headline = `Plan in ${budget} min`; out.why = "Gleicher Reiz in weniger Zeit. Die Qualität bleibt, der Umfang geht runter."; }
    }
    return out;
  }
  if (level === "plus") {
    out.headline = "Heute geht mehr";
    if (!meta.ride) {
      out.why = "Starker Tag: im Top-Set eine Wiederholung mehr oder ein zusätzlicher Back-off-Satz.";
      out.adjusted = { name: `${event.name} · Plus`, moving_time: (planMin + 5) * 60,
        description: `Plus-Variante nach Check-in: Top-Set +1 Wdh ODER 1 Back-off-Satz mehr. Kein Grinder, RPE-Deckel 8,5.\n\n${event.description || ""}` };
    } else if (kind === "threshold") {
      const d2 = dur + 2;
      out.why = `Gleiche Watt, ${reps * 2} Minuten mehr an der Schwelle. Schwelle wächst über Zeit, nicht über Watt.`;
      out.adjusted = { name: `Schwelle ${reps}x${d2} (Plus)`, moving_time: (planMin + reps * 2) * 60,
        description: `Plus-Variante: ${reps}x${d2} @ 93–95 % (${wr(93, 95)}). HF > 177 vor der letzten Wdh → zurück auf Plan.\n\n- 12m ramp 45-75%\n\n${reps}x\n- ${d2}m 93-95%\n- 5m 50%\n\n- 5m 50%` };
    } else if (kind === "vo2") {
      out.why = "Zwei Wiederholungen mehr pro Satz. Nach Satz 2 entscheiden, ob der dritte lang bleibt.";
      out.adjusted = { name: `VO2 ${vo.name} ${reps}x${dur + 2} (Plus)`, moving_time: (planMin + 5) * 60,
        description: `Plus-Variante: ${reps}x${dur + 2} statt ${reps}x${dur}. Wdh > 5 % unter der ersten → Satz beenden.\n\n- 12m ramp 45-75%\n- 3m 50%\n\n${voSets(reps, dur + 2)}\n\n- 8m 50%` };
    } else if (kind === "sst" || kind === "long") {
      out.why = "Ein Block mehr im Sweet Spot, solange die HF unter 174 bleibt.";
      out.adjusted = { name: `${head} · +1 SST-Block`, moving_time: (planMin + 20) * 60,
        description: `Plus-Variante: ein zusätzlicher 15-min-Block @ 86–89 % (${wr(86, 89)}) am Ende, HF ≤ 174.\n\n${event.description || ""}` };
    } else {
      const t = planMin + 15;
      out.why = "15 Minuten länger im selben Bereich. Mehr Volumen, keine Extra-Härte.";
      out.adjusted = { name: `${head} · ${t} min`, moving_time: t * 60,
        description: `Plus-Variante: ${t} min, HF ≤ 140.\n\n- 10m ramp 45-62%\n- ${t - 15}m 62-68%\n- 5m 50%` };
    }
    return out;
  }
  if (level === "rest") {
    out.headline = "Heute frei";
    out.why = "Voll erholen und morgen frisch zurückkommen. Nicht nachholen.";
    out.adjusted = { name: `Frei (statt ${event.name})`, moving_time: 0, description: "Ruhetag nach Check-in. Verpasste Einheiten nicht nachholen.", icu_training_load: 0 };
    return out;
  }
  if (level === "upper") {
    out.headline = "Nur Oberkörper";
    out.why = "Beine bleiben heute raus. Oberkörper wie geplant.";
    out.adjusted = { name: `${head} · nur Upper`, moving_time: Math.min(planMin, 45) * 60,
      description: `Angepasst nach Check-in: kein Lower, keine Sprünge. Oberkörper laut Hevy-Routine, RPE-Deckel 8.\n\nGeplant war: ${event.name}` };
    return out;
  }
  if (level === "z2") {
    const min = Math.min(budget || 60, kind === "long" ? 90 : 60);
    out.headline = `Z2 statt ${meta.label}`;
    out.why = kind === "test" ? "Ein Test lohnt nur frisch. Heute locker, Test morgen." : "Locker fahren hält dich im Rhythmus. Der harte Reiz kommt, wenn du frisch bist.";
    out.adjusted = { name: `Z2 ${min} (statt ${meta.label})`, moving_time: min * 60, description: z2Text(min) };
    return out;
  }
  // easier
  if (!meta.ride) {
    out.headline = "Top-Set halten, Rest kürzen";
    out.why = "Der schwere Satz bleibt, Back-offs und ein Satz Zubehör fallen weg.";
    out.adjusted = { name: `${event.name} · gekürzt`, moving_time: Math.min(planMin, 45) * 60,
      description: `Angepasst nach Check-in: nur Top-Set im Lower, Back-off-Sätze streichen, Isolation 1 Satz weniger.\n\n${event.description || ""}` };
    return out;
  }
  const min = budget ? Math.min(budget, planMin) : planMin;
  if (kind === "vo2" || kind === "threshold") {
    // 10 min Einfahren + r x (d + 5) + 5 min Ausfahren müssen in die verfügbare Zeit passen
    const d = kind === "vo2" ? 10 : dur, r = Math.max(1, Math.min(kind === "vo2" ? 3 : reps, Math.floor((min - 15) / (d + 5))));
    out.headline = `Sweet Spot statt ${meta.label}`;
    out.why = "Eine Stufe runter: gleicher Rhythmus, deutlich weniger Kosten.";
    out.adjusted = { name: `SST ${r}x${d} (statt ${meta.label})`, moving_time: (15 + r * (d + 5)) * 60,
      description: `Angepasst nach Check-in. SST @ 86–89 % (${wr(86, 89)}), HF ≤ 174.\n\n- 10m ramp 45-75%\n\n${r}x\n- ${d}m 86-89%\n- 5m 50%\n\n- 5m 50%` };
  } else if (kind === "long" && min < planMin - 5) {
    // Wenig Zeit und nicht ganz frisch: kurze Tempo-Einheit
    const f = fitBlocks(reps, dur, min);
    out.headline = `Tempo in ${min} min`;
    out.why = "Kurz und eine Zone tiefer. Rhythmus halten, Kosten klein.";
    out.adjusted = { name: `Tempo ${f.r}x${f.d} (statt Q2)`, moving_time: min * 60,
      description: `Angepasst nach Check-in. Tempo @ 76–82 % (${wr(76, 82)}), HF ≤ 155.\n\n${f.steps(76, 82)}` };
  } else if (kind === "long") {
    // Umfang halten, Intensität eine Zone runter: Volumen ist der Zweck der langen Einheit
    const pre = Math.max(20, min - reps * (dur + 5) - 25);
    out.headline = "Tempo statt Sweet Spot";
    out.why = "Die Dauer bleibt, die Blöcke laufen eine Zone tiefer. Das Volumen ist heute der Reiz.";
    out.adjusted = { name: `Long ${reps}x${dur} Tempo (statt SST)`, moving_time: min * 60,
      description: `Angepasst nach Check-in. Blöcke im Tempo @ 76–82 % (${wr(76, 82)}), HF ≤ 155. Keine Antritte.\n\n- 15m ramp 45-64%\n- ${pre}m 60-65%\n\n${reps}x\n- ${dur}m 76-82%\n- 5m 55%\n\n- 10m 50%` };
  } else if (kind === "sst") {
    out.headline = "Tempo statt Sweet Spot";
    out.why = "Der Block bleibt drin, aber eine Zone tiefer.";
    out.adjusted = { name: `Tempo ${reps}x${dur} (statt SST)`, moving_time: min * 60,
      description: `Angepasst nach Check-in. Tempo @ 76–82 % (${wr(76, 82)}), HF ≤ 155.\n\n- 12m ramp 45-70%\n\n${reps}x\n- ${dur}m 76-82%\n- 5m 55%\n\n- 8m 50%` };
  } else {
    const t = Math.min(min, 45);
    out.headline = `Kurz und locker (${t} min)`;
    out.why = "Bewegung ja, Belastung nein. HF unter 135.";
    out.adjusted = { name: `Z2 low ${t}`, moving_time: t * 60, description: z2Text(t) };
  }
  return out;
}

// Blöcke der langen Einheit in ein Zeitbudget legen: 10 min Einfahren + Z2-Vorlauf + r x (d + 5) + 5 min Ausfahren.
// Passen die geplanten Blöcke, bleiben sie und nur der Z2-Vorlauf schrumpft. Sonst die meiste Zeit in der Zone, lange Blöcke zuerst.
function fitBlocks(reps, dur, budget) {
  let best = { r: reps, d: dur };
  if (reps * (dur + 5) + 15 > budget) {
    best = { r: 1, d: 10 };
    for (const d of [20, 15, 10]) {
      const r = Math.min(3, Math.floor((budget - 15) / (d + 5)));
      if (r >= 1 && r * d <= reps * dur && r * d > best.r * best.d) best = { r, d };
    }
  }
  const pre = Math.max(0, budget - 15 - best.r * (best.d + 5));
  return { ...best, pre, steps: (lo, hi) => `- 10m ramp 45-70%\n${pre ? `- ${pre}m 60-65%\n` : ""}\n${best.r}x\n- ${best.d}m ${lo}-${hi}%\n- 5m 55%\n\n- 5m 50%` };
}

function shorten({ kind, reps, dur, budget, event, wr, vo, voSets }) {
  if (kind === "long") {
    // Long ohne Zeit wird zur SST-Einheit (Winterplan: "Kein Long möglich → SST")
    const f = fitBlocks(reps, dur, budget);
    return { name: `SST ${f.r}x${f.d} (gekürzt)`, moving_time: budget * 60,
      description: `Gekürzt auf ${budget} min, statt der langen Einheit. SST @ 86–89 % (${wr(86, 89)}), HF ≤ 174. Keine Antritte.\n\n${f.steps(86, 89)}` };
  }
  if (kind === "threshold" || kind === "sst") {
    const d = dur, work = budget - 20;
    const r = Math.max(1, Math.min(reps, Math.floor((work + 5) / (d + 5))));
    if (r === reps) return null;
    const [lo, hi, label] = kind === "threshold" ? [93, 95, "Schwelle"] : [86, 89, "SST"];
    return { name: `${label} ${r}x${d} (gekürzt)`, moving_time: budget * 60,
      description: `Gekürzt auf ${budget} min. ${label} @ ${lo}–${hi} % (${wr(lo, hi)}), eine Wiederholung weniger.\n\n- 10m ramp 45-75%\n\n${r}x\n- ${d}m ${lo}-${hi}%\n- 5m 50%\n\n- 5m 50%` };
  }
  if (kind === "vo2") {
    const sets = budget >= 45 ? 2 : 1; // 12 + 2x13 + 5 min passen in 45
    return { name: `VO2 ${vo.name} ${sets}x${dur} (gekürzt)`, moving_time: budget * 60,
      description: `Gekürzt auf ${budget} min.\n\n- 12m ramp 45-75%\n\n${voSets(sets, dur)}\n\n- 5m 50%` };
  }
  if (kind === "fatmax" || kind === "z2") {
    return { name: `${event.name.split("·")[0].trim()} (${budget} min)`, moving_time: budget * 60,
      description: `Gekürzt auf ${budget} min. HF ≤ 140.\n\n- ${budget}m 60-68%` };
  }
  return null;
}

export const LEVEL_TONE = { plus: "good", go: "good", easier: "warn", z2: "warn", upper: "warn", rest: "bad" };
export const scoreWord = (s) => (s >= 85 ? "Stark" : s >= 75 ? "Bereit" : s >= 55 ? "Solide" : s >= 35 ? "Müde" : "Leer");
