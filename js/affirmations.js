// Affirmationen: stark, nach vorn, ehrlich. Sie sollen tragen und anschieben.
// {ctl}, {days}, {ftp}, {gap}, {streak} werden mit echten Daten gefüllt.

const A = {
  key: [
    "Heute wirst du besser. Nicht irgendwann. Heute.",
    "Du hast dir diese Einheit verdient. Jetzt hol sie dir.",
    "Andere sind um diese Uhrzeit fertig mit dem Tag. Du fängst gerade an, stärker zu werden.",
    "Noch {gap} Watt bis 332. Heute holst du dir ein Stück davon.",
    "Du hast schon härtere Einheiten gefahren als diese. Diese hier gehört dir.",
    "Jede Minute an der Schwelle ist eine Minute, die im Mai für dich arbeitet.",
    "Der Job hat heute seinen Teil bekommen. Jetzt bist du dran.",
    "Ruhig rein, stark raus. Du weißt, wie das geht.",
    "Die erste Wiederholung entscheidet nichts. Die letzte zeigt, wer du geworden bist.",
    "Genau für solche Tage hast du dir diese Form aufgebaut.",
  ],
  easy: [
    "Heute baust du den Motor, auf dem alles andere läuft.",
    "Ruhige Kilometer, starkes Fundament. So fahren die, die im Mai vorne sind.",
    "Jede lockere Stunde macht die harten schneller. Roll los.",
    "Puls unter 135, Kopf frei. Du lädst gerade auf.",
    "Disziplin heißt heute: locker bleiben. Das können die wenigsten. Du schon.",
  ],
  gym: [
    "Eine Wiederholung mehr als letzte Woche. So wird man stark.",
    "Du baust einen Körper, der viel kann. Heute kommt wieder ein Stück dazu.",
    "Die Beine, die du heute baust, tragen dich im Mai über Bensberg.",
    "Stark auf dem Rad, stark an der Hantel. Das schaffen wenige. Du bist einer davon.",
    "Saubere Sätze, volle Spannung. Heute holst du dir Kraft.",
    "Jeder Satz ist eine Einzahlung. Du bist längst im Plus.",
  ],
  rest: [
    "Heute wächst, was du diese Woche gebaut hast.",
    "Erholung ist der Moment, in dem Training zu Form wird. Du wirst gerade stärker.",
    "Du bist genau da, wo der Plan dich haben will. Morgen geht es weiter.",
    "Akku laden. Die nächste Einheit wartet schon auf deine frischen Beine.",
  ],
  low: [
    "Auch an schweren Tagen kommst du. Genau das macht den Unterschied.",
    "Heute klug, morgen stark. So fährt jemand, der im Mai ankommen will.",
    "Du tauchst auf, auch wenn der Tag hart war. Das ist die eigentliche Stärke.",
    "Angepasst ist nicht weniger. Es ist die Einheit, die dich heute weiterbringt.",
    "Der Tag war voll. Du bist trotzdem hier. Das zählt doppelt.",
  ],
  plus: [
    "Heute ist dein Tag. Nimm dir, was drin ist.",
    "Starke Beine, klarer Kopf. Solche Tage nutzt man.",
    "Du bist frisch. Zeig dir selbst, was du draufhast.",
  ],
  done: [
    "Erledigt. Das nimmt dir heute keiner mehr.",
    "Wieder geliefert. So entsteht Form: Tag für Tag.",
    "Arbeit gemacht. Du bist heute besser als gestern.",
    "{streak} Wochen in Folge voll im Plan. Du bist eine Maschine.",
    "Abgehakt. Jetzt essen, schlafen, stärker aufwachen.",
  ],
  test: [
    "Heute zeigst du dir, was du dir erarbeitet hast.",
    "Start kontrolliert, Ende ehrlich. Die Zahl kommt von allein.",
    "Du hast die Arbeit gemacht. Heute holst du dir das Ergebnis.",
  ],
  general: [
    "Noch {days} Tage bis Köln. Du wirst bereit sein.",
    "Fitness {ctl}, aufgebaut neben einem vollen Job. Darauf kannst du stolz sein.",
    "{streak} Wochen am Stück. Du bist der Typ, der durchzieht.",
    "4 Watt pro Kilo. Du bist auf dem Weg dorthin, Einheit für Einheit.",
  ],
};

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

export function affirmation({ context, date, vars, salt = 0 }) {
  const ok = (t) => [...t.matchAll(/\{(\w+)\}/g)].every(([, k]) => vars[k] != null && vars[k] !== "" && !(k === "streak" && vars[k] < 3) && !(k === "gap" && vars[k] <= 0));
  let pool = [...(A[context] || []), ...(salt % 3 === 2 ? A.general : [])].filter(ok);
  if (!pool.length) pool = A.general.filter(ok);
  const t = pool[(hash(date + context) + salt) % pool.length];
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
}
