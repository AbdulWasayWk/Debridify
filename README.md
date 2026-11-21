# Debridify

A local Stremio addon that stands in for Torrentio when it's down. It searches torrent sites live for movies,
series and **anime**, shows which results are cached on **TorBox** (⚡), and plays them through TorBox.

Everything runs in Docker. You don't need Node, Jackett or Redis on the host.

## Quick start

1. Put your TorBox API key in `.env` (`TORBOX_API_KEY=...`; see `.env.example` for all options).
2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. In Stremio, install `http://127.0.0.1:7000/manifest.json`, or open `http://127.0.0.1:7000/configure` for options
   (sorting, quality filters, cached-only, a per-install API key).

To use it from another device (TV, phone), set `BASE_URL=http://<your-LAN-IP>:7000` in `.env`, run
`docker compose up -d` again, and install from that address.

After changing `.env`, run `docker compose up -d` to recreate the container. After pulling code changes, run
`docker compose up -d --build`.

## Always on

The container uses `restart: always`, and Docker starts at boot, so the addon comes up by itself after a reboot
and restarts if it crashes. It's light: about 90–120 MB of RAM, 0% CPU when idle, and a brief spike while a
search runs. Memory is capped at 512 MB, and Docker logs are rotated (30 MB max).

- `docker compose stop app`: pauses it until the next reboot.
- `docker compose down`: removes it until you run `docker compose up -d` again.

## Everyday commands

```bash
docker compose logs -f app                                  # live logs
docker compose restart app                                  # restart
docker compose down                                         # stop (keeps the cache volume)
curl localhost:7000/health                                  # TorBox account + provider status
```

## Development (still Docker-only)

```bash
docker compose stop app && docker compose --profile dev up dev     # live-reload server, ./src mounted
docker compose run --rm dev npm test                               # unit tests
docker compose run --rm dev npm run smoke -- tt0111161             # movie search from the CLI
docker compose run --rm dev npm run smoke -- tt0944947:1:1         # series episode
docker compose run --rm dev npm run smoke -- kitsu:46474:5         # anime by Kitsu id
```

The production image build also runs the typecheck and the tests, so a broken change fails `--build`.

## Sources

| Source | Used for |
|---|---|
| YTS | Movies (by IMDb id) |
| EZTV | TV (by IMDb id) |
| Nyaa | Anime |
| SubsPlease | Airing anime |
| Knaben | Meta-search over TPB, 1337x, Nyaa, RuTracker and more |
| The Pirate Bay (apibay) | Movies and TV |
| Torrents-CSV | Extra coverage |
| Jackett / Prowlarr | Optional; set `JACKETT_*` / `PROWLARR_*` in `.env` (`docker compose --profile jackett up -d jackett`) |

All sources run in parallel with a timeout. A source that keeps failing is paused for 5 minutes.

## Anime

Supports both Cinemeta IDs (`tt…:season:episode`) and Kitsu IDs (`kitsu:…:episode`, from the Anime Kitsu
catalog). IMDb seasons are mapped to the right anime entry, so `Frieren S2E05` finds `[SubsPlease] Sousou no
Frieren S2 - 05`, `Jujutsu Kaisen S2E05` finds `Jujutsu Kaisen - 29` (absolute numbering), and season batches
are matched too. When a batch is cached, the exact episode file inside it is picked.

## Playback behaviour

- **⚡ cached**: plays immediately.
- **⏳ not cached**: clicking it adds the torrent to TorBox and plays a short "being cached" clip. Try again
  once TorBox finishes downloading it.

## Data

The SQLite cache and the anime ID map live in the `debridify-data` Docker volume. `docker compose down -v` wipes
them, and they rebuild on the next start.
