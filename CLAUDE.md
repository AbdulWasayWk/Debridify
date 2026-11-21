# Debridify

Local Stremio addon that replaces Torrentio when it is down. It searches public torrent sources live,
checks which results are cached on **TorBox**, and streams them through TorBox. It is built to run on
the user's own machine (`npm start`, port 7000), not as a public service.

## Commands

**Docker-only.** The user wants nothing installed on the host: no local Node, `node_modules`, `dist` or `data`.
Run all tooling through compose, never `npm install` on the host. To change dependencies, regenerate the
lockfile in a container:
`docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only`.

- `docker compose up -d --build`: build and run the addon (`app`, runtime target). The build runs typecheck and tests first.
- `docker compose logs -f app`: logs (pretty by default; `LOG_PRETTY=false` for JSON).
- `docker compose stop app && docker compose --profile dev up dev`: live-reload dev server with `./src`, `./test` and `./scripts` mounted.
- `docker compose run --rm dev npm test`: unit tests (`node --test` through tsx).
- `docker compose run --rm dev npm run typecheck`
- `docker compose run --rm dev npm run smoke -- tt0111161` / `-- tt0944947:1:1` / `-- kitsu:46474:5`: runs the full search pipeline from the CLI and prints ranked results.

Dockerfile stages: `dev` (full deps and sources), `build` (typecheck, test, tsc), `runtime` (dist plus prod deps,
with a healthcheck). Data (SQLite cache and anime map) is in the `debridify-data` volume at `/data`.

Install in Stremio: `http://localhost:7000/manifest.json` (or open `http://localhost:7000/configure`).

## Environment (`.env`)

| Var | Default | Notes |
|---|---|---|
| `TORBOX_API_KEY` | — | Without it the addon falls back to plain P2P `infoHash` streams. |
| `PORT` | `7000` | |
| `BASE_URL` | `http://127.0.0.1:${PORT}` | Used to build `/resolve` URLs. Set to a LAN IP to use from a TV/phone. |
| `PROVIDER_TIMEOUT_MS` | `7000` | Per-provider budget; slow sources are dropped, not awaited. |
| `DISABLED_PROVIDERS` | — | Comma list, e.g. `torrentscsv,subsplease`. |
| `JACKETT_URL` / `JACKETT_API_KEY` | — | Optional Torznab source (`.../api/v2.0`). |
| `PROWLARR_URL` / `PROWLARR_API_KEY` | — | Optional Torznab source. |
| `LOG_LEVEL` | `info` | |
| `LOG_PRETTY` | `true` | pino-pretty output; `false` for raw JSON. |
| `DATA_DIR` | `/data` in Docker | SQLite cache and anime ID map live here (a Docker volume). |

## Findings that drove the design (Nov 2026)

### Why the old app failed at anime
- Anime was detected with `Country=Japan && Genre=Animation` from OMDb, which misses a lot and needs an API key.
- It looked up AniList by searching `"<IMDb title> Season N"`, which picks the wrong entry often, then walked
  PREQUEL/SEQUEL chains with 600 ms sleeps (seconds per request).
- It fired roughly 40 queries × 2 indexers through Jackett per episode, so it was slow and still missed things.
- It only matched `SxxEyy` for TV and had no batch/pack support. Most older anime exists only as batches.
- It did not support `kitsu:` IDs, which the Anime Kitsu catalog (and so most anime browsing in Stremio) uses.

### Source availability, probed from this machine
| Source | Status | How used |
|---|---|---|
| YTS API (`movies-api.accel.li`, yts.mx is dead) | ✅ | Movies by IMDb ID |
| EZTV API (`eztvx.to/api/get-torrents?imdb_id=`) | ✅ | Series by IMDb ID, has season/episode fields |
| apibay (TPB JSON API) | ✅ | `q=tt…` returns IMDb-tagged results; also title queries |
| Knaben API (`api.knaben.org/v1`, POST JSON) | ✅ | Meta-search over TPB, 1337x, Nyaa, RuTracker, etc. The best general source |
| Nyaa RSS (`nyaa.si/?page=rss`) | ✅ | Primary anime source (has `nyaa:infoHash`, seeders, size) |
| SubsPlease API (`subsplease.org/api/?f=search`) | ✅ | Airing and seasonal anime, returns magnets |
| Torrents-CSV (`torrents-csv.com/service/search`) | ✅ | Extra general coverage |
| TorBox Search API (`search-api.torbox.app`) | ❌ no DNS record | Implemented behind a circuit breaker in case it returns |
| AnimeTosho feed | ❌ "Feed disabled" | Not used |
| TorrentGalaxy, yts.mx | ❌ NXDOMAIN | Not used |
| Torrentio | ✅ (for now) | Not used as a source, since this addon exists for when it's down |

### Metadata (no API keys needed)
- **Cinemeta** (`v3-cinemeta.strem.io/meta/{type}/{tt}.json`): name, year, and every episode with season/number.
  This replaces OMDb, so the OMDb key is no longer needed.
- **Anime Kitsu addon** (`anime-kitsu.strem.fun/meta/{type}/kitsu:{id}.json`): aliases (romaji/english/native),
  and every video carries `imdbSeason`, `imdbEpisode`, `absoluteEpisode`. This is how IMDb numbering is
  mapped to per-season anime numbering, the same approach Torrentio uses.
- **Fribb anime-lists** (`anime-list-full.json`, ~7.5 MB, ~40k entries): maps `imdb_id[]` ↔ `kitsu_id`,
  `anilist_id`, `mal_id`, with `season.tvdb` and `episode_offset`. It is downloaded to `DATA_DIR`. A check at
  startup and then every 24 h re-downloads it once the saved copy is over 7 days old. It is the anime detector: an IMDb ID in this list counts as anime.

### TorBox API (`https://api.torbox.app/v1/api`, `Authorization: Bearer KEY`)
- `GET /torrents/checkcached?hash=a,b,c&format=object&list_files=true`: about 100 hashes per call, fast, cached for 1 h server-side.
- `POST /torrents/createtorrent` (multipart: `magnet`, `allow_zip=false`) returns `data.torrent_id`.
- `GET /torrents/mylist?id=X&bypass_cache=true` returns `download_present`, `download_finished`, `files[{id,name,short_name,size,mimetype}]`.
- `GET /torrents/requestdl?token=KEY&torrent_id=X&file_id=Y` returns a CDN URL (valid about 3 h to start).
- Responses look like `{ success, error, detail, data }`.

### Title parsing
`@viren070/parse-torrent-title` (a TS port of PTT) handles anime well: `"[SubsPlease] Sousou no Frieren S2 (01-10)"`
gives `seasons:[2], episodes:[1..10]`, and `"One Piece - 1100"` gives `episodes:[1100]`. It also extracts resolution,
quality, codec, HDR, audio, languages, group, and complete/batch flags.

## Architecture

```
Stremio ──GET /{cfg?}/stream/{type}/{id}.json──► routes (src/index.ts)
   │
   ├─ meta/context.ts   id → SearchContext (titles, year, S/E, anime mapping: kitsu entry, rel/abs episode)
   │     ├─ cinemeta.ts, kitsu.ts, animeMap.ts (Fribb)
   ├─ providers/*       all run in parallel, each with a timeout + circuit breaker, results cached in SQLite
   ├─ search/matcher.ts title relevance + episode/season/absolute/pack matching → candidates (with file hints)
   ├─ debrid/torbox.ts  batch checkcached → cached flag + file list (used to pick the exact episode file in packs)
   ├─ search/ranker.ts  filter (CAM etc.), sort (cached → resolution → quality → seeders), per-resolution limits
   └─ format.ts         Torrentio-style stream cards
Stremio plays ──GET /{cfg}/resolve/torbox/{hash}/{fileHint}──► debrid/resolve.ts
   find-or-create torrent on TorBox → pick file → requestdl → 302 to CDN (or "being cached" video)
```

- **Speed**: providers run concurrently under a hard timeout. Search results are cached per query (SQLite, TTL
  scaled by content age), metadata for days, and the anime map in memory. Stream responses use
  stale-while-revalidate: a repeat open returns at once and refreshes in the background. Concurrent identical
  work is deduped (`cache.dedupe`).
- **Config**: env sets defaults. A `/configure` page builds a base64url JSON segment in the URL
  (`/{config}/manifest.json`) for per-install preferences (sort, quality exclusions, cached-only, max results,
  optional API key override), the same model Torrentio uses.
- **No debrid key**: returns `infoHash`/`fileIdx` P2P streams, so the addon still works for testing.

## Conventions
- TypeScript ESM, Node 24, native `fetch` (no axios). Tabs, width 120 (`.prettierrc`).
- Imports use `.js` suffixes (tsc `NodeNext`-compatible output).
- Every outbound HTTP call goes through `lib/http.ts` (timeout, UA, JSON/text helpers).
- Providers implement `Provider` in `providers/types.ts` and must never throw past `runProviders`.
- Log with `logger` (pino). No `console.log` outside scripts.
- Stream objects carry **`title` only, never also `description`**. stremio-core aliases `title` → `description`,
  so sending both is a serde duplicate-field error and Stremio silently shows zero streams. curl output looks fine
  when this happens.

## Legacy
`jackett/` holds the old Jackett config. Jackett is now optional (the `jackett` compose profile). Redis, OMDb and
Real-Debrid code were removed. Git history has them if needed.
