// Kleine SVG-Charts ohne Abhängigkeiten. Farben kommen aus CSS-Variablen,
// Text trägt immer Text-Farben, nie die Serienfarbe.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tooltip(host) {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true;
  host.style.position = "relative"; host.appendChild(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html; tip.hidden = false;
      const w = tip.offsetWidth, hw = host.clientWidth;
      tip.style.left = Math.max(4, Math.min(hw - w - 4, x - w / 2)) + "px";
      tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
    },
    hide() { tip.hidden = true; },
  };
}

// Spinnendiagramm: axes = [{label, value (0..1.1 = Anteil am Ziel), detail}]
export function radar(host, axes, { title }) {
  host.innerHTML = "";
  const S = 320, c = S / 2, R = 104, n = axes.length;
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": title });
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
  const poly = (r) => axes.map((_, i) => pt(i, r).map((x) => x.toFixed(1)).join(",")).join(" ");
  [0.5, 0.75].forEach((f) => svg.appendChild(el("polygon", { points: poly(R * f), class: "rd-grid" })));
  axes.forEach((_, i) => { const [x, y] = pt(i, R); svg.appendChild(el("line", { x1: c, y1: c, x2: x, y2: y, class: "rd-grid" })); });
  svg.appendChild(el("polygon", { points: poly(R), class: "rd-target" }));
  const vals = axes.map((a, i) => pt(i, R * Math.max(0.08, Math.min(1.12, a.value))));
  svg.appendChild(el("polygon", { points: vals.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" "), class: "rd-area" }));
  const tip = tooltip(host);
  axes.forEach((a, i) => {
    const [x, y] = vals[i];
    svg.appendChild(el("circle", { cx: x, cy: y, r: 4.5, class: "rd-dot" }));
    const [lx, ly] = pt(i, R + 22);
    const anchor = Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end";
    const t = el("text", { x: lx, y: ly - 3, "text-anchor": anchor, class: "rd-label" }, a.label);
    const t2 = el("text", { x: lx, y: ly + 11, "text-anchor": anchor, class: "rd-value" }, a.short || Math.round(a.value * 100) + " %");
    svg.append(t, t2);
    const hit = el("circle", { cx: x, cy: y, r: 22, fill: "transparent", tabindex: 0 });
    const show = () => tip.show(`<b>${esc(a.label)}</b><br>${esc(a.detail)}`, (x / S) * host.clientWidth, (y / S) * host.clientWidth);
    hit.addEventListener("pointerenter", show); hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", tip.hide); hit.addEventListener("blur", tip.hide);
    hit.addEventListener("click", show);
    svg.appendChild(hit);
  });
  host.prepend(svg);
}

// Linie mit optionaler Ziel-Linie. points = [{x: Date, y, label}]
export function line(host, points, { title, unit = "", target = null, yMin, yMax, marks = [] }) {
  host.innerHTML = "";
  const Wd = 340, H = 160, m = { l: 34, r: 14, t: 12, b: 22 };
  const svg = el("svg", { viewBox: `0 0 ${Wd} ${H}`, role: "img", "aria-label": title });
  const xs = [...points.map((p) => +p.x), ...marks.map((k) => +k.x)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = [...points.map((p) => p.y), ...marks.map((k) => k.y), ...(target != null ? [target] : [])];
  const lo = yMin ?? Math.floor((Math.min(...ys) - 2) / 5) * 5, hi = yMax ?? Math.ceil((Math.max(...ys) + 2) / 5) * 5;
  const X = (v) => m.l + ((+v - x0) / (x1 - x0 || 1)) * (Wd - m.l - m.r);
  const Y = (v) => H - m.b - ((v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  for (let i = 0; i <= 2; i++) {
    const v = lo + ((hi - lo) * i) / 2;
    svg.appendChild(el("line", { x1: m.l, x2: Wd - m.r, y1: Y(v), y2: Y(v), class: "ch-grid" }));
    svg.appendChild(el("text", { x: m.l - 6, y: Y(v) + 3.5, "text-anchor": "end", class: "ch-axis" }, Math.round(v)));
  }
  const fmtD = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  svg.appendChild(el("text", { x: m.l, y: H - 5, class: "ch-axis" }, fmtD(x0)));
  svg.appendChild(el("text", { x: Wd - m.r, y: H - 5, "text-anchor": "end", class: "ch-axis" }, fmtD(x1)));
  if (marks.length) {
    svg.appendChild(el("polyline", { points: marks.map((k) => `${X(k.x).toFixed(1)},${Y(k.y).toFixed(1)}`).join(" "), class: "ch-target" }));
    marks.forEach((k) => svg.appendChild(el("circle", { cx: X(k.x), cy: Y(k.y), r: 3.5, class: "ch-mark" })));
    const last = marks[marks.length - 1];
    svg.appendChild(el("text", { x: X(last.x) - 6, y: Y(last.y) - 7, "text-anchor": "end", class: "ch-note" }, `Ziel ${last.y}${unit}`));
  }
  svg.appendChild(el("polyline", { points: points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" "), class: "ch-line", pathLength: 1 }));
  const lp = points[points.length - 1];
  svg.appendChild(el("circle", { cx: X(lp.x), cy: Y(lp.y), r: 4.5, class: "ch-dot" }));
  const cross = el("line", { y1: m.t, y2: H - m.b, class: "ch-cross", visibility: "hidden" });
  const cdot = el("circle", { r: 4.5, class: "ch-dot", visibility: "hidden" });
  svg.append(cross, cdot);
  const tip = tooltip(host);
  const over = el("rect", { x: m.l, y: m.t, width: Wd - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
  const move = (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * Wd;
    let best = points[0]; for (const p of points) if (Math.abs(X(p.x) - px) < Math.abs(X(best.x) - px)) best = p;
    cross.setAttribute("x1", X(best.x)); cross.setAttribute("x2", X(best.x)); cross.setAttribute("visibility", "visible");
    cdot.setAttribute("cx", X(best.x)); cdot.setAttribute("cy", Y(best.y)); cdot.setAttribute("visibility", "visible");
    tip.show(`<b>${Math.round(best.y * 10) / 10}${unit}</b><br>${fmtD(best.x)}`, (X(best.x) / Wd) * r.width, (Y(best.y) / H) * r.height);
  };
  const out = () => { cross.setAttribute("visibility", "hidden"); cdot.setAttribute("visibility", "hidden"); tip.hide(); };
  over.addEventListener("pointermove", move); over.addEventListener("pointerdown", move); over.addEventListener("pointerleave", out);
  svg.appendChild(over);
  host.prepend(svg);
}

// Balken: bars = [{label, value, sub, current}]
export function bars(host, data, { title, unit = "", ref = null }) {
  host.innerHTML = "";
  const Wd = 340, H = 150, m = { l: 34, r: 8, t: 10, b: 22 };
  const svg = el("svg", { viewBox: `0 0 ${Wd} ${H}`, role: "img", "aria-label": title });
  const hi = Math.ceil(Math.max(...data.map((d) => d.value), ref || 0) / 100) * 100 || 100;
  const Y = (v) => H - m.b - (v / hi) * (H - m.t - m.b);
  const step = (Wd - m.l - m.r) / data.length, bw = Math.min(22, step - 4);
  [0, hi / 2, hi].forEach((v) => {
    svg.appendChild(el("line", { x1: m.l, x2: Wd - m.r, y1: Y(v), y2: Y(v), class: "ch-grid" }));
    svg.appendChild(el("text", { x: m.l - 6, y: Y(v) + 3.5, "text-anchor": "end", class: "ch-axis" }, Math.round(v)));
  });
  if (ref) {
    svg.appendChild(el("line", { x1: m.l, x2: Wd - m.r, y1: Y(ref), y2: Y(ref), class: "ch-target" }));
    svg.appendChild(el("text", { x: Wd - m.r, y: Y(ref) - 5, "text-anchor": "end", class: "ch-note" }, `Erhalt ~${ref}`));
  }
  const tip = tooltip(host);
  data.forEach((d, i) => {
    const x = m.l + i * step + (step - bw) / 2, y = Y(d.value), h = Math.max(1, H - m.b - y);
    const r = Math.min(4, h);
    const path = `M${x},${H - m.b} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - m.b} Z`;
    svg.appendChild(el("path", { d: path, class: d.current ? "ch-bar ch-bar-now" : "ch-bar" }));
    if (i % 2 === (data.length - 1) % 2) svg.appendChild(el("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "ch-axis" }, d.label));
    const hit = el("rect", { x: m.l + i * step, y: m.t, width: step, height: H - m.t - m.b, fill: "transparent" });
    const show = () => tip.show(`<b>${Math.round(d.value)}${unit}</b><br>${esc(d.sub)}`, ((x + bw / 2) / Wd) * host.clientWidth, (y / H) * svg.getBoundingClientRect().height);
    hit.addEventListener("pointerenter", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", tip.hide);
    svg.appendChild(hit);
  });
  host.prepend(svg);
}

// Ring für den Bereitschafts-Score
export function ring(host, score, word) {
  const S = 132, r = 54, C = 2 * Math.PI * r;
  host.innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Bereitschaft ${score} von 100">
    <circle cx="66" cy="66" r="${r}" class="rg-track"/>
    <circle cx="66" cy="66" r="${r}" class="rg-val" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 66 66)"/>
    <text x="66" y="66" text-anchor="middle" class="rg-num">${score}</text>
    <text x="66" y="86" text-anchor="middle" class="rg-word">${esc(word)}</text></svg>`;
  requestAnimationFrame(() => requestAnimationFrame(() => host.querySelector(".rg-val").setAttribute("stroke-dashoffset", C * (1 - score / 100))));
}
