// Curated rail interchanges: walks between stops that the station name merge
// and the 250 m proximity radius miss, and real walk times that replace the
// generic 180 s same-station change.
// Source: docs/design/transit-and-planner.md §3.4, ids checked against the
// 2026-10-23 rapid-rail-kl and ktmb feeds (network ids, `rail:` / `ktm:`).
// The times are estimates until walked. Set `verified: true` only after an
// in-person walk; an unverified time shows as "about".

export interface Interchange {
  /** Network stop ids. The transfer runs both ways. */
  a: string;
  b: string;
  seconds: number;
  /** Shown in the UI. */
  note: string;
  verified: boolean;
}

export const RAIL_INTERCHANGES: readonly Interchange[] = [
  { a: "rail:KJ15", b: "rail:MR1", seconds: 480, note: "Walk via NU Sentral mall", verified: false },
  { a: "rail:KJ15", b: "ktm:19100", seconds: 180, note: "Walk to the KTM platforms in KL Sentral", verified: false }, // KL SENTRAL
  { a: "rail:KG15", b: "rail:KJ15", seconds: 360, note: "Walk to KL Sentral", verified: false },
  { a: "rail:KJ14", b: "rail:KG16", seconds: 240, note: "Walk between the LRT and MRT Pasar Seni stations", verified: false },
  { a: "rail:KJ14", b: "ktm:19000", seconds: 420, note: "Walk to KTM Kuala Lumpur", verified: false }, // KUALA LUMPUR
  { a: "rail:KJ13", b: "rail:AG7", seconds: 180, note: "Walk between the Masjid Jamek platforms", verified: false },
  { a: "rail:KJ13", b: "rail:SP7", seconds: 180, note: "Walk between the Masjid Jamek platforms", verified: false },
  { a: "rail:MR4", b: "rail:AG9", seconds: 180, note: "Walk between the Hang Tuah platforms", verified: false },
  { a: "rail:MR4", b: "rail:SP9", seconds: 180, note: "Walk between the Hang Tuah platforms", verified: false },
  { a: "rail:MR6", b: "rail:KG18A", seconds: 240, note: "Walk between the Monorail and MRT Bukit Bintang stations", verified: false },
  { a: "rail:KJ12", b: "rail:MR8", seconds: 300, note: "Walk between Dang Wangi and Bukit Nanas", verified: false },
  { a: "rail:AG8", b: "rail:KG17", seconds: 300, note: "Walk between Plaza Rakyat and Merdeka", verified: false },
  { a: "rail:SP8", b: "rail:KG17", seconds: 300, note: "Walk between Plaza Rakyat and Merdeka", verified: false },
  { a: "rail:AG6", b: "ktm:18900", seconds: 360, note: "Walk between Bandaraya and KTM Bank Negara", verified: false }, // BANK NEGARA
  { a: "rail:SP6", b: "ktm:18900", seconds: 360, note: "Walk between Bandaraya and KTM Bank Negara", verified: false }, // BANK NEGARA
  { a: "rail:KJ28", b: "ktm:53700", seconds: 180, note: "Walk to KTM Subang Jaya", verified: false }, // SUBANG JAYA
  { a: "rail:BRT1", b: "ktm:53600", seconds: 180, note: "Walk to KTM Setia Jaya", verified: false }, // SETIA JAYA
  { a: "rail:BRT7", b: "rail:KJ31", seconds: 120, note: "Walk between the BRT and LRT USJ 7 stations", verified: false },
  { a: "rail:KJ17", b: "ktm:52700", seconds: 180, note: "Walk to KTM Abdullah Hukum", verified: false }, // ABDULLAH HUKUM
  { a: "rail:KJ37", b: "rail:SP31", seconds: 60, note: "Cross the platform", verified: false },
];
