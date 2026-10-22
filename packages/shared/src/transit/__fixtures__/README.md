# GTFS fixtures

Data: data.gov.my (Prasarana, KTMB), CC BY 4.0. Redistributed unmodified for tests.

## 2026-10-23

Captured 2026-10-23 ~02:01 MYT, one request every 16 s (data.gov.my allows 4 per minute per API family).

| File | Source | Bytes | SHA-256 |
|---|---|---:|---|
| `rapid-rail-kl.zip` | `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl` | 80,289 | `3b00cf0debb428a3533f67c29f9c3c87e09ba9735c05569368a033c9a4491614` |
| `rapid-bus-kl.zip` | `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl` | 1,683,443 | `8f3fb25db2c6bc326b2ee9da30edbff9059c600379ae9b076ff2d21161e0674c` |
| `rapid-bus-mrtfeeder.zip` | `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder` | 2,022,515 | `f7b0b37ae6f3051d61f93531dd67620a6da59074d59cd45162652f9bbcf8f7f6` |
| `ktmb.zip` | `https://api.data.gov.my/gtfs-static/ktmb` | 46,962 | `159166887ffc1a326e178ba6a890fc27d229ad69e2013d2e32830375f6eba826` |

### Quirks confirmed by hand (plan 12/00 step 2)

- **Rail `shapes.txt`:** the header is `shape_id,shape_pt_lon,shape_pt_lat,shape_pt_sequence` and the values match their headers (lon ≈ 101.7 under `shape_pt_lon`). Reading by column name is enough; nothing is swapped.
- **Rail `stops.txt`:** has the `geometry` column (value `[object Object]`), plus `category`, `route_id`, `isOKU`, `status`, `search`.
- **Rail headways over 720 s:** one window, `PYL_MonFri_1` 22:00–24:00 every 840 s. Rail headways range 180/420/840 s (min/median/max).
- **KTMB routes:** `KC05_KB18` Seremban Line, `KA15_KD19` Port Klang Line (Komuter, used for routing), and `100_47300` Padang Besar Line, `100_9000` Ipoh Line, `SS` Shuttle Selatan, `ETS`, `SH`, `ERT`, `ST` (excluded).
- **Calendars (start → end):**
  - rail: `MonFri`, `MonThu`, `Fri`, `Sat`, `Sun`, `SatSun` 20190101 → **20261231**; legacy `weekday`/`weekend` ended 20260331.
  - rapid-bus-kl: `weekday`, `weekend` 20200401 → 20270331 (no `calendar_dates`).
  - rapid-bus-mrtfeeder: `26100201` 20261022 → 20261113, `26100203` 20261024 → 20261115 (+ `calendar_dates`).
  - ktmb: `ets`, `intercity`, `komuter_utara`, `komuter_weekday`, `shuttle_selatan` 20260818 → **20261106**; `komuter_weekend` 20260822 → 20261106.

### Sizing for service date 2026-10-28 (Wednesday)

`pnpm -C packages/shared exec tsx scripts/network-sizing.ts src/transit/__fixtures__/2026-10-23 20261028`

| Feed | Stops served | Patterns | Trips, all expanded | Stop events, all expanded | Freq windows | Turn-up-and-go | Trips after rule | Stop events after rule |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rail | 187 | 16 | 2,779 | 66,142 | 74 | 74 | 0 | 0 |
| bus-kl | 4,036 | 171 | 6,817 | 262,666 | 1,181 | 137 | 5,531 | 213,418 |
| feeder | 2,117 | 92 | 3,443 | 95,718 | 0 | 0 | 3,443 | 95,718 |
| ktmb (national) | 155 | 91 | 305 | 4,034 | 0 | 0 | 305 | 4,034 |
| KTM Komuter in Klang Valley bbox | 49 | 18 | 90 | 1,355 | 0 | 0 | 90 | 1,355 |

"After rule" = spec §3.3: every rail window and bus windows ≤ 720 s stay frequency windows; longer bus windows expand to trips. Routed network (rail + bus-kl + feeder + Komuter KV): ≈ 2.66 MB of typed arrays.

Differences from the spec §1 Python estimate: windows expand with an inclusive end here (as `expandFrequencies` does), so expanded trip counts are higher (bus-kl 6,817 vs 5,830); stops count only stops a trip serves on the date.
