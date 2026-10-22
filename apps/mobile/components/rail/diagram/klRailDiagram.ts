/**
 * The schematic KL rail map (plan 13/06): the eight Rapid KL lines and KTM
 * Komuter's Seremban and Port Klang lines inside the Klang Valley box, hand
 * placed on an octilinear grid. No runtime projection.
 *
 * - `x`, `y`: grid units (`GRID` points each at scale 1), y down. Every
 *   segment between consecutive stations is horizontal, vertical or 45°, and
 *   lines only bend at stations.
 * - Ids are `RAIL_STATIONS` slugs, and the network's `ktm-<slug>` ids for
 *   KTM (12/02 `compileNetwork`), so each opens `/station?station=<id>`.
 * - `label`: the name's offset from the station point in points at scale 1
 *   (`dy` to the baseline), or null where a linked station carries it.
 * - The core keeps the official Rapid KL map's arrangement: Masjid Jamek in
 *   the middle, Pasar Seni below it, KL Sentral to the south-west, Hang Tuah
 *   and Chan Sow Lin to the south-east, Ampang Park to the north-east.
 *
 * Data only, with no imports, so a web or widget renderer can reuse it. To
 * change the drawing, move labels; stations stay put once the tests pass.
 */

/** Points per grid unit at scale 1. */
export const GRID = 24;

export interface DiagramLabel {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface DiagramStation {
  id: string;
  /** As the station sheet titles it (RAIL_STATIONS, or the KTM feed's name). */
  name: string;
  x: number;
  y: number;
  label: DiagramLabel | null;
}

export interface DiagramLine {
  /** `RailLine.code` for Rapid KL; the network's route label for KTM. */
  code: string;
  /** Display name, as `lineDisplayName`. */
  name: string;
  color: string;
  /** Station ids in order: Rapid KL in stop-code order, KTM as the feed runs. */
  branches: string[][];
}

/** The drawing's extent in grid units, labels included, from 0,0. */
export const DIAGRAM_SIZE = { width: 79, height: 59 } as const;

export const DIAGRAM_STATIONS: readonly DiagramStation[] = [
  // 1. City-core interchanges
  { id: 'masjid-jamek', name: 'Masjid Jamek', x: 51, y: 21, label: { dx: -13, dy: 4, anchor: 'end' } },
  { id: 'pasar-seni', name: 'Pasar Seni', x: 51, y: 26, label: { dx: 8, dy: 16.5, anchor: 'start' } },
  { id: 'kl-sentral', name: 'KL Sentral', x: 48, y: 29, label: { dx: 8, dy: 16.5, anchor: 'start' } },
  { id: 'hang-tuah', name: 'Hang Tuah', x: 57, y: 27, label: { dx: 15, dy: 1, anchor: 'start' } },
  { id: 'bukit-bintang', name: 'Bukit Bintang', x: 58, y: 22, label: { dx: 8, dy: -9, anchor: 'start' } },
  { id: 'chan-sow-lin', name: 'Chan Sow Lin', x: 62, y: 32, label: { dx: 11, dy: 19.5, anchor: 'start' } },
  { id: 'ampang-park', name: 'Ampang Park', x: 62, y: 14, label: { dx: 11, dy: 4, anchor: 'start' } },
  { id: 'bandaraya', name: 'Bandaraya', x: 51, y: 18, label: { dx: -13, dy: 4, anchor: 'end' } },
  { id: 'titiwangsa', name: 'Titiwangsa', x: 51, y: 11, label: { dx: 10, dy: -9, anchor: 'start' } },
  { id: 'tun-razak-exchange', name: 'Tun Razak Exchange', x: 62, y: 22, label: { dx: 8, dy: -9, anchor: 'start' } },
  { id: 'maluri', name: 'Maluri', x: 67, y: 30, label: { dx: -8, dy: -9, anchor: 'end' } },
  { id: 'sungai-besi', name: 'Sungai Besi', x: 62, y: 44, label: { dx: 11, dy: 4, anchor: 'start' } },
  // 2. Ampang and Sri Petaling lines, shared trunk
  { id: 'sultan-ismail', name: 'Sultan Ismail', x: 51, y: 16, label: { dx: -13, dy: 4, anchor: 'end' } },
  { id: 'pwtc', name: 'PWTC', x: 51, y: 14, label: { dx: 13, dy: 4, anchor: 'start' } },
  { id: 'sentul', name: 'Sentul', x: 51, y: 9, label: { dx: 13, dy: 4, anchor: 'start' } },
  { id: 'sentul-timur', name: 'Sentul Timur', x: 51, y: 7, label: { dx: 13, dy: 4, anchor: 'start' } },
  { id: 'plaza-rakyat', name: 'Plaza Rakyat', x: 53, y: 23, label: { dx: 9, dy: -10, anchor: 'start' } },
  { id: 'pudu', name: 'Pudu', x: 59.5, y: 29.5, label: { dx: 9, dy: -10, anchor: 'start' } },
  // Kelana Jaya Line, north and east
  { id: 'dang-wangi', name: 'Dang Wangi', x: 53, y: 19, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'kampung-baru', name: 'Kampung Baru', x: 58, y: 14, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'klcc', name: 'KLCC', x: 60, y: 14, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'damai', name: 'Damai', x: 63, y: 13, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'dato-keramat', name: "Dato' Keramat", x: 64, y: 12, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'jelatek', name: 'Jelatek', x: 65, y: 11, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'setiawangsa', name: 'Setiawangsa', x: 65, y: 10, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'sri-rampai', name: 'Sri Rampai', x: 65, y: 9, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'wangsa-maju', name: 'Wangsa Maju', x: 65, y: 8, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'taman-melati', name: 'Taman Melati', x: 65, y: 7, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'gombak', name: 'Gombak', x: 65, y: 6, label: { dx: 9, dy: 4, anchor: 'start' } },
  // Putrajaya Line through the core
  { id: 'hospital-kuala-lumpur', name: 'Hospital Kuala Lumpur', x: 55, y: 11, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'raja-uda', name: 'Raja Uda', x: 59, y: 11, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'persiaran-klcc', name: 'Persiaran KLCC', x: 62, y: 16, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'conlay', name: 'Conlay', x: 62, y: 19, label: { dx: 9, dy: 4, anchor: 'start' } },
  // Kajang Line through the core
  { id: 'muzium-negara', name: 'Muzium Negara', x: 49, y: 26, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'merdeka', name: 'Merdeka', x: 54, y: 26, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'cochrane', name: 'Cochrane', x: 67, y: 27, label: { dx: 9, dy: 4, anchor: 'start' } },
  // KL Monorail
  { id: 'tun-sambanthan', name: 'Tun Sambanthan', x: 51, y: 29, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'maharajalela', name: 'Maharajalela', x: 55, y: 29, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'imbi', name: 'Imbi', x: 58, y: 26, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'raja-chulan', name: 'Raja Chulan', x: 58, y: 20, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bukit-nanas', name: 'Bukit Nanas', x: 56, y: 18, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'medan-tuanku', name: 'Medan Tuanku', x: 53, y: 15, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'chow-kit', name: 'Chow Kit', x: 53, y: 13, label: { dx: 9, dy: 4, anchor: 'start' } },
  // Ampang Line, east
  { id: 'miharja', name: 'Miharja', x: 65, y: 32, label: { dx: 11, dy: 5, anchor: 'start' } },
  { id: 'pandan-jaya', name: 'Pandan Jaya', x: 68, y: 29, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'pandan-indah', name: 'Pandan Indah', x: 69, y: 28, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'cempaka', name: 'Cempaka', x: 70, y: 27, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'cahaya', name: 'Cahaya', x: 71, y: 26, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ampang', name: 'Ampang', x: 72, y: 25, label: { dx: 9, dy: 4, anchor: 'start' } },
  // Kajang Line, south-east
  { id: 'taman-pertama', name: 'Taman Pertama', x: 68, y: 31, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'taman-midah', name: 'Taman Midah', x: 69, y: 32, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'taman-mutiara', name: 'Taman Mutiara', x: 70, y: 33, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'taman-connaught', name: 'Taman Connaught', x: 71, y: 34, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'taman-suntex', name: 'Taman Suntex', x: 72, y: 35, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'sri-raya', name: 'Sri Raya', x: 73, y: 36, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bandar-tun-hussein-onn', name: 'Bandar Tun Hussein Onn', x: 73, y: 37, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'batu-11-cheras', name: 'Batu 11 Cheras', x: 73, y: 38, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bukit-dukung', name: 'Bukit Dukung', x: 73, y: 39, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'sungai-jernih', name: 'Sungai Jernih', x: 73, y: 40, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'stadium-kajang', name: 'Stadium Kajang', x: 73, y: 41, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'kajang', name: 'Kajang', x: 73, y: 42, label: { dx: 9, dy: 4, anchor: 'start' } },
  // Sri Petaling Line, south
  { id: 'cheras', name: 'Cheras', x: 62, y: 34, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'salak-selatan', name: 'Salak Selatan', x: 62, y: 37, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bandar-tun-razak', name: 'Bandar Tun Razak', x: 62, y: 39, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'bandar-tasik-selatan', name: 'Bandar Tasik Selatan', x: 62, y: 41, label: { dx: 105, dy: 4, anchor: 'start' } },
  // Putrajaya Line, south
  { id: 'kuchai', name: 'Kuchai', x: 57, y: 37, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'taman-naga-emas', name: 'Taman Naga Emas', x: 57, y: 39, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'serdang-raya-utara', name: 'Serdang Raya Utara', x: 62, y: 46, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'serdang-raya-selatan', name: 'Serdang Raya Selatan', x: 62, y: 47, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'serdang-jaya', name: 'Serdang Jaya', x: 62, y: 48, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'upm', name: 'UPM', x: 62, y: 49, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'taman-equine', name: 'Taman Equine', x: 61, y: 50, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'putra-permai', name: 'Putra Permai', x: 60, y: 51, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: '16-sierra', name: '16 Sierra', x: 59, y: 52, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'cyberjaya-utara', name: 'Cyberjaya Utara', x: 58, y: 53, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'cyberjaya-city-centre', name: 'Cyberjaya City Centre', x: 57, y: 54, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'putrajaya-sentral', name: 'Putrajaya Sentral', x: 56, y: 55, label: { dx: -9, dy: 4, anchor: 'end' } },
  // Sri Petaling Line, west
  { id: 'bukit-jalil', name: 'Bukit Jalil', x: 59.5, y: 44, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'sri-petaling', name: 'Sri Petaling', x: 57, y: 44, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'awan-besar', name: 'Awan Besar', x: 54.5, y: 44, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'muhibbah', name: 'Muhibbah', x: 52, y: 44, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'alam-sutera', name: 'Alam Sutera', x: 49.5, y: 44, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'kinrara', name: 'Kinrara', x: 47, y: 44, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'ioi-puchong-jaya', name: 'IOI Puchong Jaya', x: 44.5, y: 44, label: { dx: 10, dy: -8.5, anchor: 'middle' } },
  { id: 'pusat-bandar-puchong', name: 'Pusat Bandar Puchong', x: 43.5, y: 45, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'taman-perindustrian-puchong', name: 'Taman Perindustrian Puchong', x: 42.5, y: 46, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'bandar-puteri', name: 'Bandar Puteri', x: 41.5, y: 47, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'puchong-perdana', name: 'Puchong Perdana', x: 40.5, y: 48, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'puchong-prima', name: 'Puchong Prima', x: 39.5, y: 49, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'putra-heights', name: 'Putra Heights', x: 31, y: 57.5, label: { dx: 11, dy: 4, anchor: 'start' } },
  // Kelana Jaya Line, south-west
  { id: 'bangsar', name: 'Bangsar', x: 46, y: 31, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'abdullah-hukum', name: 'Abdullah Hukum', x: 45, y: 32, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'kerinchi', name: 'Kerinchi', x: 44, y: 33, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'universiti', name: 'Universiti', x: 43, y: 34, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'taman-jaya', name: 'Taman Jaya', x: 42, y: 35, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'asia-jaya', name: 'Asia Jaya', x: 41, y: 36, label: { dx: -6, dy: 14.5, anchor: 'end' } },
  { id: 'taman-paramount', name: 'Taman Paramount', x: 39, y: 36, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'taman-bahagia', name: 'Taman Bahagia', x: 37, y: 36, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'kelana-jaya', name: 'Kelana Jaya', x: 35, y: 36, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'lembah-subang', name: 'Lembah Subang', x: 33, y: 36, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'ara-damansara', name: 'Ara Damansara', x: 31, y: 36, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'glenmarie', name: 'Glenmarie', x: 31, y: 38, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'subang-jaya', name: 'Subang Jaya', x: 31, y: 41.5, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'ss-15', name: 'SS 15', x: 31, y: 43, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ss-18', name: 'SS 18', x: 31, y: 44, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'usj-7', name: 'USJ 7', x: 31, y: 45, label: { dx: -11, dy: 4, anchor: 'end' } },
  { id: 'taipan', name: 'Taipan', x: 31, y: 47, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'wawasan', name: 'Wawasan', x: 31, y: 49, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'usj-21', name: 'USJ 21', x: 31, y: 51, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'alam-megah', name: 'Alam Megah', x: 31, y: 53, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'subang-alam', name: 'Subang Alam', x: 31, y: 55, label: { dx: -9, dy: 4, anchor: 'end' } },
  // BRT Sunway Line
  { id: 'sunway-setia-jaya', name: 'Sunway-Setia Jaya', x: 39, y: 42, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'mentari', name: 'Mentari', x: 39, y: 43, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'sunway-lagoon', name: 'Sunway Lagoon', x: 39, y: 44, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'sunmed', name: 'SunMed', x: 39, y: 45, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'sunu-monash', name: 'SunU-Monash', x: 36.5, y: 45, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'south-quay-usj-1', name: 'South Quay-USJ 1', x: 34, y: 45, label: { dx: 0, dy: 16, anchor: 'middle' } },
  // Kajang Line, west
  { id: 'semantan', name: 'Semantan', x: 43, y: 26, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'pusat-bandar-damansara', name: 'Pusat Bandar Damansara', x: 40, y: 26, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'phileo-damansara', name: 'Phileo Damansara', x: 37, y: 26, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'taman-tun-dr-ismail', name: 'Taman Tun Dr Ismail', x: 33, y: 26, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'bandar-utama', name: 'Bandar Utama', x: 29, y: 26, label: { dx: 0, dy: -10.5, anchor: 'middle' } },
  { id: 'mutiara-damansara', name: 'Mutiara Damansara', x: 25.5, y: 26, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'surian', name: 'Surian', x: 22, y: 26, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'kota-damansara', name: 'Kota Damansara', x: 19, y: 26, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'kwasa-sentral', name: 'Kwasa Sentral', x: 15.5, y: 26, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'kwasa-damansara', name: 'Kwasa Damansara', x: 15.5, y: 24, label: { dx: 11, dy: 4, anchor: 'start' } },
  // Putrajaya Line, north-west
  { id: 'sentul-barat', name: 'Sentul Barat', x: 49, y: 11, label: { dx: -6, dy: 14.5, anchor: 'end' } },
  { id: 'jalan-ipoh', name: 'Jalan Ipoh', x: 48, y: 10, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'kentomen', name: 'Kentomen', x: 47, y: 9, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'kampung-batu', name: 'Kampung Batu', x: 43, y: 5, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'sri-delima', name: 'Sri Delima', x: 40.5, y: 5, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'jinjang', name: 'Jinjang', x: 38, y: 5, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'kepong-baru', name: 'Kepong Baru', x: 35.5, y: 5, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'metro-prima', name: 'Metro Prima', x: 33, y: 5, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'sri-damansara-timur', name: 'Sri Damansara Timur', x: 30.5, y: 5, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'sri-damansara-sentral', name: 'Sri Damansara Sentral', x: 28, y: 5, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'sri-damansara-barat', name: 'Sri Damansara Barat', x: 25.5, y: 5, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'damansara-damai', name: 'Damansara Damai', x: 23, y: 5, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'sungai-buloh', name: 'Sungai Buloh', x: 20.5, y: 5, label: { dx: -6, dy: -7, anchor: 'end' } },
  { id: 'kampung-selamat', name: 'Kampung Selamat', x: 15.5, y: 10, label: { dx: -9, dy: 4, anchor: 'end' } },
  // Shah Alam Line
  { id: 'kayu-ara', name: 'Kayu Ara', x: 29, y: 28, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bandar-utama-11', name: 'Bandar Utama 11', x: 29, y: 30, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'damansara-idaman', name: 'Damansara Idaman', x: 29, y: 32, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'subang', name: 'Subang', x: 29, y: 34.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'glenmarie-2', name: 'Glenmarie 2', x: 29, y: 38, label: { dx: -6, dy: 14.5, anchor: 'end' } },
  { id: 'kerjaya', name: 'Kerjaya', x: 26.5, y: 38, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'stadium-shah-alam', name: 'Stadium Shah Alam', x: 24, y: 38, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'dato-menteri-sa-sentral', name: "Dato' Menteri - SA Sentral", x: 21.5, y: 38, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'uitm-shah-alam', name: 'UiTM Shah Alam', x: 19, y: 38, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'seksyen-7', name: 'Seksyen 7', x: 16.5, y: 38, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'bandar-baru-klang', name: 'Bandar Baru Klang', x: 14, y: 38, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'pasar-klang', name: 'Pasar Klang', x: 11.5, y: 38, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'jalan-meru', name: 'Jalan Meru', x: 11.5, y: 41.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'jambatan-kota', name: 'Jambatan Kota', x: 11.5, y: 43, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'taman-selatan', name: 'Taman Selatan', x: 11.5, y: 44.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'seri-andalas', name: 'Seri Andalas', x: 11.5, y: 46, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'klang-jaya', name: 'Klang Jaya', x: 11.5, y: 47.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'bandar-bukit-tinggi', name: 'Bandar Bukit Tinggi', x: 11.5, y: 49, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'johan-setia', name: 'Johan Setia', x: 11.5, y: 50.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  // 3. KTM Komuter, shared through KL Sentral
  { id: 'ktm-bank-negara', name: 'Bank Negara', x: 45, y: 18, label: { dx: -13, dy: 4, anchor: 'end' } },
  { id: 'ktm-putra', name: 'Putra', x: 45, y: 14, label: { dx: 13, dy: 4, anchor: 'start' } },
  { id: 'ktm-kuala-lumpur', name: 'Kuala Lumpur', x: 45, y: 28, label: { dx: -13, dy: 4, anchor: 'end' } },
  { id: 'ktm-kl-sentral', name: 'KL Sentral', x: 48, y: 31, label: null },
  // KTM Seremban Line, south
  { id: 'ktm-perhentian-midvalley', name: 'Perhentian Midvalley', x: 50, y: 33, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-seputeh', name: 'Seputeh', x: 52.5, y: 35.5, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-salak-selatan', name: 'Salak Selatan', x: 66, y: 35.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-bdr-tasek-selatan', name: 'Bdr Tasek Selatan', x: 66, y: 41, label: null },
  { id: 'ktm-serdang', name: 'Serdang', x: 66, y: 44, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-kajang', name: 'Kajang', x: 73, y: 44, label: null },
  { id: 'ktm-kajang-2', name: 'Kajang 2', x: 73, y: 45, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-ukm', name: 'Ukm', x: 73, y: 46, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-bangi', name: 'Bangi', x: 73, y: 47, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-batang-benar', name: 'Batang Benar', x: 73, y: 48, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-nilai', name: 'Nilai', x: 73, y: 49, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-labu', name: 'Labu', x: 73, y: 50, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-tiroi', name: 'Tiroi', x: 73, y: 51, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-seremban', name: 'Seremban', x: 73, y: 52, label: { dx: 9, dy: 4, anchor: 'start' } },
  // KTM Seremban Line, north
  { id: 'ktm-sentul', name: 'Sentul', x: 45, y: 12, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'ktm-batu-kentomenn', name: 'Batu Kentomenn', x: 45, y: 10, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'ktm-kampung-batu', name: 'Kampung Batu', x: 45, y: 8.5, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'ktm-taman-wahyu', name: 'Taman Wahyu', x: 45, y: 4, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-batu-caves', name: 'Batu Caves', x: 45, y: 2.5, label: { dx: 9, dy: 4, anchor: 'start' } },
  // KTM Port Klang Line, south-west (beside the Kelana Jaya Line)
  { id: 'ktm-abdullah-hukum', name: 'Abdullah Hukum', x: 46, y: 33, label: null },
  { id: 'ktm-angkasapuri', name: 'Angkasapuri', x: 45, y: 34, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-pantai-dalam', name: 'Pantai Dalam', x: 44, y: 35, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-petaling', name: 'Petaling', x: 43, y: 36, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-jalan-templer', name: 'Jalan Templer', x: 42, y: 37, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-kg-dato-harun', name: 'Kg Dato Harun', x: 41, y: 38, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-seri-setia', name: 'Seri Setia', x: 40, y: 39, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-setia-jaya', name: 'Setia Jaya', x: 39, y: 40, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-subang-jaya', name: 'Subang Jaya', x: 32.5, y: 40, label: null },
  { id: 'ktm-batu-tiga', name: 'Batu Tiga', x: 28, y: 40, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'ktm-shah-alam', name: 'Shah Alam', x: 24.5, y: 40, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'ktm-padang-jawa', name: 'Padang Jawa', x: 21, y: 40, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'ktm-bukit-badak', name: 'Bukit Badak', x: 16, y: 40, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'ktm-klang', name: 'Klang', x: 9.5, y: 40, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-telok-pulai', name: 'Telok Pulai', x: 8.5, y: 41, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-telok-gadong', name: 'Telok Gadong', x: 7.5, y: 42, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-kg-raja-uda', name: 'Kg Raja Uda', x: 6.5, y: 43, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-jln-kastam', name: 'Jln Kastam', x: 5.5, y: 44, label: { dx: 6, dy: 14.5, anchor: 'start' } },
  { id: 'ktm-pel-klang-sel', name: 'Pel Klang Sel', x: 4.5, y: 45, label: { dx: -9, dy: 4, anchor: 'end' } },
  // KTM Port Klang Line, north
  { id: 'ktm-segambut', name: 'Segambut', x: 42, y: 14, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-kepong', name: 'Kepong', x: 36, y: 8, label: { dx: 6, dy: -7, anchor: 'start' } },
  { id: 'ktm-kepong-sentral', name: 'Kepong Sentral', x: 30.5, y: 8, label: { dx: 0, dy: 16, anchor: 'middle' } },
  { id: 'ktm-sungai-buloh', name: 'Sungai Buloh', x: 22.5, y: 8, label: { dx: 0, dy: -8.5, anchor: 'middle' } },
  { id: 'ktm-kuang', name: 'Kuang', x: 14, y: 8, label: { dx: -9, dy: 4, anchor: 'end' } },
  { id: 'ktm-rawang', name: 'Rawang', x: 14, y: 5, label: { dx: 9, dy: 4, anchor: 'start' } },
  { id: 'ktm-serendah', name: 'Serendah', x: 14, y: 2, label: { dx: 9, dy: 4, anchor: 'start' } },
];

/** Line order is drawing order, and the order of lines side by side on a shared run. */
export const DIAGRAM_LINES: readonly DiagramLine[] = [
  {
    code: 'LRT AG',
    name: 'Ampang Line',
    color: '#E57200',
    branches: [
      [
        'sentul-timur', 'sentul', 'titiwangsa', 'pwtc', 'sultan-ismail', 'bandaraya',
        'masjid-jamek', 'plaza-rakyat', 'hang-tuah', 'pudu', 'chan-sow-lin', 'miharja', 'maluri',
        'pandan-jaya', 'pandan-indah', 'cempaka', 'cahaya', 'ampang',
      ],
    ],
  },
  {
    code: 'LRT SP',
    name: 'Sri Petaling Line',
    color: '#76232F',
    branches: [
      [
        'sentul-timur', 'sentul', 'titiwangsa', 'pwtc', 'sultan-ismail', 'bandaraya',
        'masjid-jamek', 'plaza-rakyat', 'hang-tuah', 'pudu', 'chan-sow-lin', 'cheras',
        'salak-selatan', 'bandar-tun-razak', 'bandar-tasik-selatan', 'sungai-besi', 'bukit-jalil',
        'sri-petaling', 'awan-besar', 'muhibbah', 'alam-sutera', 'kinrara', 'ioi-puchong-jaya',
        'pusat-bandar-puchong', 'taman-perindustrian-puchong', 'bandar-puteri', 'puchong-perdana',
        'puchong-prima', 'putra-heights',
      ],
    ],
  },
  {
    code: 'LRT KJ',
    name: 'Kelana Jaya Line',
    color: '#D50032',
    branches: [
      [
        'gombak', 'taman-melati', 'wangsa-maju', 'sri-rampai', 'setiawangsa', 'jelatek',
        'dato-keramat', 'damai', 'ampang-park', 'klcc', 'kampung-baru', 'dang-wangi',
        'masjid-jamek', 'pasar-seni', 'kl-sentral', 'bangsar', 'abdullah-hukum', 'kerinchi',
        'universiti', 'taman-jaya', 'asia-jaya', 'taman-paramount', 'taman-bahagia', 'kelana-jaya',
        'lembah-subang', 'ara-damansara', 'glenmarie', 'subang-jaya', 'ss-15', 'ss-18', 'usj-7',
        'taipan', 'wawasan', 'usj-21', 'alam-megah', 'subang-alam', 'putra-heights',
      ],
    ],
  },
  {
    code: 'MRT KG',
    name: 'Kajang Line',
    color: '#047940',
    branches: [
      [
        'kwasa-damansara', 'kwasa-sentral', 'kota-damansara', 'surian', 'mutiara-damansara',
        'bandar-utama', 'taman-tun-dr-ismail', 'phileo-damansara', 'pusat-bandar-damansara',
        'semantan', 'muzium-negara', 'pasar-seni', 'merdeka', 'bukit-bintang',
        'tun-razak-exchange', 'cochrane', 'maluri', 'taman-pertama', 'taman-midah',
        'taman-mutiara', 'taman-connaught', 'taman-suntex', 'sri-raya', 'bandar-tun-hussein-onn',
        'batu-11-cheras', 'bukit-dukung', 'sungai-jernih', 'stadium-kajang', 'kajang',
      ],
    ],
  },
  {
    code: 'MRT PY',
    name: 'Putrajaya Line',
    color: '#FFCD00',
    branches: [
      [
        'kwasa-damansara', 'kampung-selamat', 'sungai-buloh', 'damansara-damai',
        'sri-damansara-barat', 'sri-damansara-sentral', 'sri-damansara-timur', 'metro-prima',
        'kepong-baru', 'jinjang', 'sri-delima', 'kampung-batu', 'kentomen', 'jalan-ipoh',
        'sentul-barat', 'titiwangsa', 'hospital-kuala-lumpur', 'raja-uda', 'ampang-park',
        'persiaran-klcc', 'conlay', 'tun-razak-exchange', 'chan-sow-lin', 'kuchai',
        'taman-naga-emas', 'sungai-besi', 'serdang-raya-utara', 'serdang-raya-selatan',
        'serdang-jaya', 'upm', 'taman-equine', 'putra-permai', '16-sierra', 'cyberjaya-utara',
        'cyberjaya-city-centre', 'putrajaya-sentral',
      ],
    ],
  },
  {
    code: 'Monorail MR',
    name: 'KL Monorail Line',
    color: '#84BD00',
    branches: [
      [
        'kl-sentral', 'tun-sambanthan', 'maharajalela', 'hang-tuah', 'imbi', 'bukit-bintang',
        'raja-chulan', 'bukit-nanas', 'medan-tuanku', 'chow-kit', 'titiwangsa',
      ],
    ],
  },
  {
    code: 'BRT',
    name: 'Sunway Line',
    color: '#115740',
    branches: [
      [
        'sunway-setia-jaya', 'mentari', 'sunway-lagoon', 'sunmed', 'sunu-monash',
        'south-quay-usj-1', 'usj-7',
      ],
    ],
  },
  {
    code: 'LRT SA',
    name: 'Shah Alam Line',
    color: '#00A9E0',
    branches: [
      [
        'bandar-utama', 'kayu-ara', 'bandar-utama-11', 'damansara-idaman', 'subang', 'glenmarie-2',
        'kerjaya', 'stadium-shah-alam', 'dato-menteri-sa-sentral', 'uitm-shah-alam', 'seksyen-7',
        'bandar-baru-klang', 'pasar-klang', 'jalan-meru', 'jambatan-kota', 'taman-selatan',
        'seri-andalas', 'klang-jaya', 'bandar-bukit-tinggi', 'johan-setia',
      ],
    ],
  },
  {
    code: 'KTM Seremban',
    name: 'Komuter Seremban Line',
    color: '#3C5A9F',
    branches: [
      [
        'ktm-batu-caves', 'ktm-taman-wahyu', 'ktm-kampung-batu', 'ktm-batu-kentomenn',
        'ktm-sentul', 'ktm-putra', 'ktm-bank-negara', 'ktm-kuala-lumpur', 'ktm-kl-sentral',
        'ktm-perhentian-midvalley', 'ktm-seputeh', 'ktm-salak-selatan', 'ktm-bdr-tasek-selatan',
        'ktm-serdang', 'ktm-kajang', 'ktm-kajang-2', 'ktm-ukm', 'ktm-bangi', 'ktm-batang-benar',
        'ktm-nilai', 'ktm-labu', 'ktm-tiroi', 'ktm-seremban',
      ],
    ],
  },
  {
    code: 'KTM Port Klang',
    name: 'Komuter Port Klang Line',
    color: '#DC2420',
    branches: [
      [
        'ktm-serendah', 'ktm-rawang', 'ktm-kuang', 'ktm-sungai-buloh', 'ktm-kepong-sentral',
        'ktm-kepong', 'ktm-segambut', 'ktm-putra', 'ktm-bank-negara', 'ktm-kuala-lumpur',
        'ktm-kl-sentral', 'ktm-abdullah-hukum', 'ktm-angkasapuri', 'ktm-pantai-dalam',
        'ktm-petaling', 'ktm-jalan-templer', 'ktm-kg-dato-harun', 'ktm-seri-setia',
        'ktm-setia-jaya', 'ktm-subang-jaya', 'ktm-batu-tiga', 'ktm-shah-alam', 'ktm-padang-jawa',
        'ktm-bukit-badak', 'ktm-klang', 'ktm-telok-pulai', 'ktm-telok-gadong', 'ktm-kg-raja-uda',
        'ktm-jln-kastam', 'ktm-pel-klang-sel',
      ],
    ],
  },
];

/**
 * Walking links between a rail station and the KTM station beside it, drawn
 * as connectors. The KTM end carries no label when the names match.
 */
export const DIAGRAM_LINKS: readonly (readonly [string, string])[] = [
  ['kl-sentral', 'ktm-kl-sentral'],
  ['abdullah-hukum', 'ktm-abdullah-hukum'],
  ['bandar-tasik-selatan', 'ktm-bdr-tasek-selatan'],
  ['kajang', 'ktm-kajang'],
  ['sunway-setia-jaya', 'ktm-setia-jaya'],
  ['subang-jaya', 'ktm-subang-jaya'],
];
