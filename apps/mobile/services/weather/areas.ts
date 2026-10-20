// Maps a stop's coordinates to the MET Malaysia forecast location and the
// place names MET uses in warning text, for the Klang Valley only.
//
// Data sources:
// - Forecast location ids and names come from a real /weather/forecast
//   payload (2026-10-20, 440 locations, archived by junmob/final-year-project
//   under data/raw/weather_forecast/). The API has NO coordinates, so the
//   ids are matched to areas by name: Ds057 "Petaling", Ds058 "Kuala Lumpur",
//   St008 "Selangor", St009 "WP Kuala Lumpur", St010 "WP Putrajaya", etc.
// - Warning names come from a real /weather/warning thunderstorm warning
//   (issued 2026-10-20T15:25). text_bm lists states with districts in
//   brackets, e.g. "Selangor (Hulu Selangor, Gombak, Hulu Langat dan
//   Petaling) • W.P. Kuala Lumpur • …". The federal territories appear only
//   as whole territories.
// - Anchor coordinates are approximate town centres (OpenStreetMap or
//   Wikipedia, rounded to about 100 m) for towns inside each administrative
//   district. Several anchors per district work better than one centroid
//   for odd-shaped districts like Petaling and Hulu Langat. Stops near a
//   district border can land in the neighbouring district. That's fine
//   here, because MET warnings and forecasts cover whole districts and
//   neighbours usually share them.

export type WeatherStateName = "Selangor" | "WP Kuala Lumpur" | "WP Putrajaya";

export interface WeatherArea {
  /** Stable key, e.g. "petaling". */
  key: string;
  /** Short English and Malay display name used in nudges, e.g. "Petaling". */
  label: string;
  state: WeatherStateName;
  /**
   * MET forecast location ids, most specific first (district, then state).
   * The facade fetches the first one and falls back to the next only when
   * the first returns no rows.
   */
  forecastLocationIds: readonly string[];
  /**
   * District names as they appear inside a state's brackets in MET warning
   * text (Malay spelling). Empty for the federal territories, which MET
   * names as a whole ("W.P. Kuala Lumpur").
   */
  warningDistrictNames: readonly string[];
  /**
   * How MET writes the state or territory at the start of a warning segment.
   * When this appears with no bracketed district list, the whole state is
   * covered.
   */
  warningStateNames: readonly string[];
  /** Label used when a warning covers the whole state. */
  stateLabel: string;
}

interface AreaDef extends WeatherArea {
  anchors: readonly (readonly [lat: number, lng: number])[];
}

const SELANGOR_NAMES = ["Selangor"] as const;
const KL_NAMES = [
  "W.P. Kuala Lumpur",
  "WP Kuala Lumpur",
  "Wilayah Persekutuan Kuala Lumpur",
  "Kuala Lumpur",
] as const;
const PUTRAJAYA_NAMES = [
  "W.P. Putrajaya",
  "WP Putrajaya",
  "Wilayah Persekutuan Putrajaya",
  "Putrajaya",
] as const;

function selangor(
  key: string,
  label: string,
  districtId: string,
  warningDistrictNames: readonly string[],
  anchors: AreaDef["anchors"],
): AreaDef {
  return {
    key,
    label,
    state: "Selangor",
    forecastLocationIds: [districtId, "St008"],
    warningDistrictNames,
    warningStateNames: SELANGOR_NAMES,
    stateLabel: "Selangor",
    anchors,
  };
}

const AREAS: readonly AreaDef[] = [
  {
    key: "kuala-lumpur",
    label: "Kuala Lumpur",
    state: "WP Kuala Lumpur",
    forecastLocationIds: ["Ds058", "St009"],
    warningDistrictNames: [],
    warningStateNames: KL_NAMES,
    stateLabel: "Kuala Lumpur",
    anchors: [
      [3.1478, 101.6953], // KLCC / city centre
      [3.1300, 101.6700], // Bangsar
      [3.1850, 101.6900], // Sentul
      [3.2100, 101.6360], // Kepong
      [3.1950, 101.7170], // Setapak
      [3.2050, 101.7350], // Wangsa Maju
      [3.1870, 101.6680], // Segambut
      [3.0880, 101.7190], // Bandar Tun Razak
      [3.0560, 101.7080], // Sungai Besi
      [3.0580, 101.6900], // Bukit Jalil
      [3.0800, 101.7380], // Cheras (Taman Connaught)
      [3.1110, 101.6670], // Mid Valley
    ],
  },
  {
    key: "putrajaya",
    label: "Putrajaya",
    state: "WP Putrajaya",
    forecastLocationIds: ["Ds062", "St010"],
    warningDistrictNames: [],
    warningStateNames: PUTRAJAYA_NAMES,
    stateLabel: "Putrajaya",
    anchors: [
      [2.9264, 101.6964],
      [2.9430, 101.6990],
      [2.9100, 101.6800],
    ],
  },
  selangor("petaling", "Petaling", "Ds057", ["Petaling"], [
    [3.1073, 101.6067], // Petaling Jaya
    [3.1050, 101.5930], // Kelana Jaya
    [3.1470, 101.6150], // Bandar Utama
    [3.1500, 101.5900], // Kota Damansara
    [3.0733, 101.5185], // Shah Alam
    [3.0500, 101.5850], // Subang Jaya
    [3.0250, 101.6170], // Puchong
    [3.0210, 101.7060], // Seri Kembangan
    [3.2050, 101.5800], // Sungai Buloh
  ]),
  selangor("klang", "Klang", "Ds054", ["Klang"], [
    [3.0449, 101.4456], // Klang
    [3.0000, 101.3920], // Pelabuhan Klang
    [3.1400, 101.3830], // Kapar
  ]),
  selangor("gombak", "Gombak", "Ds055", ["Gombak"], [
    [3.2450, 101.6530], // Selayang
    [3.2379, 101.6840], // Batu Caves
    [3.3213, 101.5767], // Rawang
    [3.2560, 101.7090], // Gombak (Taman Perwira)
    [3.2000, 101.7550], // Ulu Kelang
  ]),
  selangor("hulu-langat", "Hulu Langat", "Ds063", ["Hulu Langat", "Ulu Langat"], [
    [2.9927, 101.7909], // Kajang
    [3.0500, 101.7600], // Cheras (Batu 9)
    [3.1500, 101.7600], // Ampang
    [3.1300, 101.7500], // Pandan Indah
    [3.0300, 101.7500], // Balakong
    [2.9520, 101.8430], // Semenyih
    [2.9600, 101.7600], // Bandar Baru Bangi
  ]),
  selangor("sepang", "Sepang", "Ds064", ["Sepang"], [
    [2.9213, 101.6559], // Cyberjaya
    [2.8600, 101.6800], // Dengkil
    [2.8170, 101.7340], // Bandar Baru Salak Tinggi
    [2.7456, 101.7072], // KLIA
    [2.6900, 101.7500], // Sepang town
  ]),
  selangor("kuala-langat", "Kuala Langat", "Ds060", ["Kuala Langat"], [
    [2.8130, 101.5020], // Banting
    [2.8800, 101.5000], // Jenjarom
    [2.9400, 101.4600], // Telok Panglima Garang
    [2.6600, 101.5600], // Tanjung Sepat
  ]),
  selangor("kuala-selangor", "Kuala Selangor", "Ds049", ["Kuala Selangor"], [
    [3.3400, 101.2500], // Kuala Selangor
    [3.4250, 101.1800], // Tanjong Karang
    [3.2300, 101.4500], // Puncak Alam
    [3.3200, 101.4200], // Ijok
  ]),
  selangor("hulu-selangor", "Hulu Selangor", "Ds051", ["Hulu Selangor", "Ulu Selangor"], [
    [3.5640, 101.6580], // Kuala Kubu Bharu
    [3.3700, 101.6000], // Serendah
    [3.4700, 101.6400], // Batang Kali
    [3.4300, 101.5400], // Bukit Beruntung
  ]),
];

/** Stops farther than this from every anchor get no weather area. */
export const MAX_AREA_DISTANCE_KM = 15;

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function strip(def: AreaDef): WeatherArea {
  const { anchors: _anchors, ...area } = def;
  return area;
}

/**
 * Nearest-anchor lookup. Returns null when the stop is outside the Klang
 * Valley (more than MAX_AREA_DISTANCE_KM from every anchor) or the
 * coordinates aren't finite.
 */
export function areaForLocation(lat: number, lng: number): WeatherArea | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: AreaDef | null = null;
  let bestKm = Infinity;
  for (const def of AREAS) {
    for (const [aLat, aLng] of def.anchors) {
      const km = distanceKm(lat, lng, aLat, aLng);
      if (km < bestKm) {
        bestKm = km;
        best = def;
      }
    }
  }
  return best && bestKm <= MAX_AREA_DISTANCE_KM ? strip(best) : null;
}

/** Looks up an area by key, e.g. for tests or a user-chosen home area. */
export function areaByKey(key: string): WeatherArea | null {
  const def = AREAS.find((a) => a.key === key);
  return def ? strip(def) : null;
}

export const ALL_WEATHER_AREAS: readonly WeatherArea[] = AREAS.map(strip);
