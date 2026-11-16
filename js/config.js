// Ziele, Meilensteine und Blöcke aus docs/plan/Winterplan_2026-27_Block1.md (v7.1).
// Ändert sich der Plan, hier nachziehen.
export const GOAL = {
  ftp: 332,
  weight: 83,
  race: { name: "Rund um Köln", date: "2027-05-23" },
  milestones: [
    { date: "2026-12-05", ftp: 303, label: "FTP-Test", note: "Anker bestätigen" },
    { date: "2027-01-30", ftp: 313, label: "FTP-Test", note: "Ziel 312–315 W" },
    { date: "2027-02-27", ftp: 318, label: "Test vor Girona", note: "Ziel 318 W" },
    { date: "2027-04-24", ftp: 325, label: "Test im April", note: "Ziel 325 W" },
    { date: "2027-05-23", ftp: 332, label: "Rund um Köln", note: "4,0 W/kg" },
  ],
  // Leistungsprofil, das zu 332 W FTP als Allrounder passt
  profile: { s5: 1250, m1: 520, m5: 388, m20: 349, m60: 300 },
  ctl: 76,
};

// Blockplan bis Rund um Köln (Winterplan v7.1, Abschnitt "Blockplan"). Entlastung = Start der Entlastungswoche.
export const BLOCKS = [
  { n: 2, name: "Übergang", from: "2026-11-16", to: "2026-12-06", focus: "Umfang auf 4 Rad-Tage, Schwelle wieder aufnehmen", deload: "2026-11-30", test: "2026-12-05", hours: "6:30–7:15 h", tss: "375–410" },
  { n: 3, name: "Schwelle I", from: "2026-12-07", to: "2027-01-03", focus: "Schwelle 40 → 45 min, SST 60 → 75 min", deload: "2026-12-28", hours: "7:15–8 h", tss: "420–460" },
  { n: 4, name: "Schwelle II", from: "2027-01-04", to: "2027-01-31", focus: "Schwelle 44 → 50 min, SST 75 → 80 min", deload: "2027-01-25", test: "2027-01-30", hours: "7:30–8 h", tss: "430–480" },
  { n: 5, name: "Pre-Girona", from: "2027-02-01", to: "2027-02-28", focus: "Schwelle halten, rennspezifisch: Over-Unders, Surge and Settle", deload: "2027-02-22", test: "2027-02-27", hours: "7–8 h", tss: "420–470" },
  { n: 6, name: "Girona", from: "2027-03-01", to: "2027-03-28", focus: "Volumen, Anstiege 15–30 min bei 90–100 %", hours: "Camp 15–20 h", tss: "600–800 im Camp" },
  { n: 7, name: "VO2", from: "2027-03-29", to: "2027-04-25", focus: "VO2-Decke anheben (5 min ≈ 385–390 W), Schwelle halten", deload: "2027-04-19", test: "2027-04-24", hours: "7:30–9 h", tss: "450–520" },
  { n: 8, name: "Rennform", from: "2027-04-26", to: "2027-05-16", focus: "Race-Pace, Punch, Durability", hours: "7–8 h", tss: "420–460" },
  { n: 9, name: "Taper", from: "2027-05-17", to: "2027-05-23", focus: "Frisch werden, TSB +5–10", hours: "4 h", tss: "~180 + Rennen" },
];
