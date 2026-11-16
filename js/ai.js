// Optionale KI-Einschätzung. Die Regeln entscheiden, Claude kommentiert nur.
// Statische App ohne Build-Schritt, deshalb ein direkter HTTP-Aufruf statt SDK.
// Der Anthropic-Key liegt nur im localStorage dieses Geräts.

const LS = "hc.anthropicKey";
export const getAiKey = () => { try { return localStorage.getItem(LS) || ""; } catch { return ""; } };
export const setAiKey = (k) => { try { k ? localStorage.setItem(LS, k.trim()) : localStorage.removeItem(LS); } catch {} };

const SYSTEM = `Du bist ein Hybrid-Performance-Coach (Rennrad + Kraft). Dein Athlet trainiert neben einem vollen Job auf ein FTP-Ziel und ein Rennen im Frühjahr hin; die Zahlen stehen in den Daten.
Eine Regel-Engine hat drei Varianten für heute gebaut und eine empfohlen, der Athlet hat eine gewählt. Deine Aufgabe: seine Wahl in 2 bis 4 kurzen Sätzen einordnen.
- Deutsch, locker, direkt, per Du. Kein Markdown, keine Aufzählung.
- Sag, ob du seine Wahl teilst oder eine andere der drei Varianten nehmen würdest. Wenn du abweichst, sag konkret wie (Watt, Dauer) und warum.
- Nenne genau einen Ausführungshinweis für heute.
- Schließe mit einem starken, motivierenden Satz, der ihn nach vorn trägt. Kein Kitsch, keine Ausrufezeichen.
Grundsätze: max. 2 Qualitätseinheiten pro Woche, lockere Einheiten über HF-Deckel 135, verpasste Einheiten nicht nachholen, Schlaf < 6 h oder Ruhepuls > 55 heißt keine Intervalle, er überzieht gern, wenn es sich gut anfühlt.`;

export async function coachNote(context, signal) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": getAiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: "Daten für heute (JSON):\n" + JSON.stringify(context, null, 1) }],
    }),
  });
  if (res.status === 401) throw new Error("Anthropic-Key ungültig.");
  if (res.status === 429) throw new Error("Gerade zu viele Anfragen. Gleich nochmal versuchen.");
  if (!res.ok) throw new Error(`KI nicht erreichbar (${res.status}).`);
  const msg = await res.json();
  if (msg.stop_reason === "refusal") throw new Error("Die KI hat keine Einschätzung gegeben.");
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Leere Antwort der KI.");
  return text;
}
