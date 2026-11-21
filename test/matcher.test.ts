import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeHash, parseMagnet } from "../src/lib/magnet.js";
import { normalizeTitle, parseTitle, titleMatches } from "../src/lib/parse.js";
import { selectFile } from "../src/search/files.js";
import { matchTorrent } from "../src/search/matcher.js";
import type { RawTorrent, SearchContext } from "../src/types.js";

const raw = (title: string, extra: Partial<RawTorrent> = {}): RawTorrent => ({
	infoHash: "a".repeat(40),
	title,
	source: "test",
	provider: "test",
	...extra,
});
const match = (ctx: SearchContext, title: string, extra?: Partial<RawTorrent>) =>
	matchTorrent(ctx, raw(title, extra), parseTitle(title))?.kind ?? null;

const movie: SearchContext = {
	id: "tt15239678",
	type: "movie",
	imdbId: "tt15239678",
	name: "Dune: Part Two",
	queryTitles: ["Dune: Part Two"],
	matchTitles: [normalizeTitle("Dune: Part Two")],
	year: 2024,
	isAnime: false,
};

const got: SearchContext = {
	id: "tt0944947:1:5",
	type: "series",
	imdbId: "tt0944947",
	name: "Game of Thrones",
	queryTitles: ["Game of Thrones"],
	matchTitles: [normalizeTitle("Game of Thrones")],
	season: 1,
	episode: 5,
	isAnime: false,
};

// Frieren season 2 episode 5 = IMDb S02E05, absolute 33.
const frierenS2: SearchContext = {
	id: "tt22248376:2:5",
	type: "series",
	imdbId: "tt22248376",
	name: "Frieren: Beyond Journey's End",
	queryTitles: ["Sousou no Frieren 2nd Season"],
	matchTitles: ["frieren beyond journeys end", "frieren", "sousou no frieren 2nd season", "sousou no frieren"],
	season: 2,
	episode: 5,
	isAnime: true,
	anime: {
		kitsuId: 49240,
		relEpisode: 5,
		absEpisode: 33,
		entrySeason: 2,
		isFirstEntry: false,
		entryTitles: ["sousou no frieren 2nd season", "frieren beyond journeys end season 2"],
		baseTitles: ["sousou no frieren", "frieren beyond journeys end", "frieren"],
		queryTitles: ["Sousou no Frieren 2nd Season"],
		baseQueryTitle: "Sousou no Frieren",
		isMovie: false,
	},
};

const onePiece: SearchContext = {
	id: "kitsu:12:1100",
	type: "series",
	imdbId: "tt0388629",
	name: "One Piece",
	queryTitles: ["One Piece"],
	matchTitles: ["one piece"],
	season: 21,
	episode: 208,
	isAnime: true,
	anime: {
		kitsuId: 12,
		relEpisode: 1100,
		absEpisode: 1100,
		entrySeason: 1,
		isFirstEntry: true,
		entryTitles: ["one piece"],
		baseTitles: ["one piece"],
		queryTitles: ["One Piece"],
		isMovie: false,
	},
};

describe("title matching", () => {
	it("normalises punctuation and articles", () => {
		assert.equal(normalizeTitle("Frieren: Beyond Journey's End"), "frieren beyond journeys end");
		assert.ok(titleMatches("The Office US", ["office"]));
		assert.ok(!titleMatches("Dune Part Two Behind the Scenes Special", [normalizeTitle("Dune: Part Two")]));
		assert.ok(titleMatches("Frieren - Beyond Journey's End (Sousou no Frieren)", ["sousou no frieren"]));
	});
});

describe("movies", () => {
	it("accepts the right movie and year", () => {
		assert.equal(match(movie, "Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX"), "single");
	});
	it("rejects other years and other titles", () => {
		assert.equal(match(movie, "Dune.1984.1080p.BluRay.x264"), null);
		assert.equal(match(movie, "Dune.Prophecy.S01E01.1080p.WEB"), null);
	});
	it("trusts IMDb-verified providers", () => {
		assert.equal(match(movie, "Some weird name 1080p", { imdbVerified: true }), "single");
	});
});

describe("western series", () => {
	it("matches the exact episode and season packs", () => {
		assert.equal(match(got, "Game.of.Thrones.S01E05.1080p.BluRay.x264"), "single");
		assert.equal(match(got, "Game of Thrones Season 1 Complete 1080p"), "pack");
		assert.equal(match(got, "Game.Of.Thrones.S01-S04.BluRay.4K.UHD.H265"), "pack");
	});
	it("rejects other episodes and seasons", () => {
		assert.equal(match(got, "Game.of.Thrones.S01E06.1080p.BluRay.x264"), null);
		assert.equal(match(got, "Game.of.Thrones.S02.1080p.BluRay"), null);
	});
	it("uses EZTV season/episode fields", () => {
		assert.equal(match(got, "whatever", { imdbVerified: true, season: 1, episode: 5 }), "single");
		assert.equal(match(got, "whatever", { imdbVerified: true, season: 1, episode: 4 }), null);
	});
});

describe("anime", () => {
	it("matches season-tagged relative numbering", () => {
		assert.equal(match(frierenS2, "[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [6AAEC79A].mkv"), "single");
		assert.equal(
			match(frierenS2, "[Erai-raws] Sousou no Frieren 2nd Season - 05 [1080p CR WEB-DL AVC AAC][MultiSub]"),
			"single",
		);
		assert.equal(match(frierenS2, "Frieren Beyond Journey's End S02E05 1080p WEB x264"), "single");
	});
	it("matches absolute numbering without a season", () => {
		assert.equal(match(frierenS2, "[Group] Sousou no Frieren - 33 [1080p]"), "single");
	});
	it("does not mistake season 1 episode 5 for season 2 episode 5", () => {
		assert.equal(match(frierenS2, "[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv"), null);
		assert.equal(match(frierenS2, "[SubsPlease] Sousou no Frieren S2 - 06 (1080p)"), null);
	});
	it("accepts season batches and ranges that contain the episode", () => {
		assert.equal(match(frierenS2, "[SubsPlease] Sousou no Frieren S2 (01-10) (1080p) [Batch]"), "pack");
		assert.equal(
			match(
				frierenS2,
				"[Erai-raws] Sousou no Frieren 2nd Season [1080p CR WEBRip HEVC AAC][MultiSub] (unofficial batch)",
			),
			"pack",
		);
		assert.equal(match(frierenS2, "[SubsPlease] Sousou no Frieren (01-28) (1080p) [Batch]"), null);
	});
	it("handles long-running absolute numbering", () => {
		assert.equal(match(onePiece, "[SubsPlease] One Piece - 1100 (1080p) [F9FD18AE].mkv"), "single");
		assert.equal(match(onePiece, "[HatSubs] One Piece 1100-1104 (BD 1080p 10-bit Opus)"), "pack");
		assert.equal(match(onePiece, "[SubsPlease] One Piece - 1101 (1080p)"), null);
		assert.equal(match(onePiece, "One Punch Man - 05 [1080p]"), null);
	});
});

describe("file selection in packs", () => {
	const files = [
		{ index: 0, name: "Frieren S2/[Group] Sousou no Frieren S2 - 04 [1080p].mkv", size: 1e9 },
		{ index: 1, name: "Frieren S2/[Group] Sousou no Frieren S2 - 05 [1080p].mkv", size: 1e9 },
		{ index: 2, name: "Frieren S2/[Group] Sousou no Frieren S2 - 06 [1080p].mkv", size: 1e9 },
		{ index: 3, name: "Frieren S2/NCOP.mkv", size: 1e8 },
	];
	it("picks the requested episode", () => {
		assert.equal(selectFile(frierenS2, files, "pack")?.index, 1);
	});
	it("prefers absolute numbering in multi-season batches", () => {
		const batch = [
			{ index: 0, name: "Frieren/[G] Sousou no Frieren - 05.mkv", size: 1e9 },
			{ index: 1, name: "Frieren/[G] Sousou no Frieren - 33.mkv", size: 1e9 },
		];
		assert.equal(selectFile(frierenS2, batch, "pack")?.index, 1);
	});
	it("returns null when a pack lacks the episode", () => {
		assert.equal(selectFile(frierenS2, files.slice(2), "pack"), null);
	});
	it("uses season folders when filenames only have numbers", () => {
		const pack = [
			{ index: 0, name: "Game of Thrones/Season 1/04.mkv", size: 1e9 },
			{ index: 1, name: "Game of Thrones/Season 1/05.mkv", size: 1e9 },
		];
		assert.equal(selectFile(got, pack, "pack")?.index, 1);
	});
});

describe("magnets", () => {
	it("normalises base32 hashes", () => {
		assert.equal(normalizeHash("VLJ3XGIWPFSZPFC3WRVIL2UCEQFHAW2B"), "aad3bb9916796597945bb46a85ea82240a705b41");
		assert.equal(parseMagnet("magnet:?xt=urn:btih:AAD3BB9916797932BC5BB46A85EA82240A705B41&xl=100")?.size, 100);
	});
});
