/** What a ride costs, for the bus opened full screen. */
export interface Fare {
  /** "RM1.00", or a range where the fare goes by zone. */
  adult: string;
  /** With a Rapid Pelajar (students) or Rapid Emas (60+) card: half fare. */
  concession: string;
}

/**
 * Prasarana's GTFS feeds carry no fares, so these are MyRapid's own
 * (myrapid.com.my, checked Oct 2026): feeder buses are a flat RM1, other
 * Rapid KL buses go by zone, RM1 to RM5. Concession cards halve either;
 * Rapid Mesra (OKU) rides free and the My50 pass covers both. Kept by hand.
 */
export function fareFor(routeCode: string): Fare {
  return isFeederRoute(routeCode)
    ? { adult: 'RM1.00', concession: 'RM0.50' }
    : { adult: 'RM1 – RM5', concession: 'Half fare' };
}

/** Rapid KL numbers its feeder routes (LRT and MRT) T…: "T816". */
export function isFeederRoute(routeCode: string): boolean {
  return /^T\d/i.test(routeCode.trim());
}
