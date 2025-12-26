import type { Stream } from "@stremio-addon/sdk";
import type {
	JackettTorrentDataType,
	OMDBDataType,
	OMDBMovieDataType,
	OMDBSeriesDataType,
	QualityKey,
	TorrentDataType,
} from "../types.ts";
import logger from "./logger.ts";
import type { Response } from "express";

const PORT = process.env.PORT;

const qualities = ["2160p", "1440p", "1080p", "720p", "480p", "360p"];

const indexers = [
	"therarbg",
	"1337x",
	"thepiratebay",
	"yts",
	"rutor",
	"uindex",
	"eztv",
	"ilcorsaronero",
	"kickasstorrentsws",
	"nyaasi",
	"subsplease",
	"animetosho",
	"extratorrentst",
];

const animeCountries = ["Japan", "China", "South Korea"];

const qualitiesToTextMapping: Record<QualityKey, string> = {
	"2160p": "4K",
	"1440p": "UHD",
	"1080p": "1080p",
	"720p": "720p",
	"480p": "480p",
	"360p": "360p",
};

// Helper to safely get mapped text
const getQualityText = (quality: string | null | undefined): string => {
	if (!quality) return "Unknown";
	if ((quality as QualityKey) in qualitiesToTextMapping) {
		return qualitiesToTextMapping[quality as QualityKey];
	}
	return "Unknown";
};

const extractQuality = (title: string) => {
	const lowerTitle = title.toLowerCase();
	const found = qualities.find((q) => lowerTitle.includes(q));
	return found || null;
};

const sortByIndexerQualityAndSize = (torrents: Array<TorrentDataType>): Array<TorrentDataType> => {
	// Build a quick lookup for quality index
	const qualityMap: Record<string, number> = Object.fromEntries(qualities.map((q, idx) => [q, idx]));
	const indexersMap: Record<string, number> = Object.fromEntries(indexers.map((i, idx) => [i, idx]));

	return torrents
		.map((t) => {
			// Assign a numeric index for sorting
			const indexer = t.jackettindexer.toLowerCase().replaceAll(" ", "");

			const qualityIndex = t.quality ? (qualityMap[t.quality] ?? qualities.length) : qualities.length;

			const indexerIndex = indexer ? (indexersMap[indexer] ?? indexers.length) : indexers.length;

			return { ...t, indexerIndex, qualityIndex };
		})
		.sort((a, b) => {
			// Sort by quality (lower index = higher quality)
			if (a.qualityIndex !== b.qualityIndex) return a.qualityIndex - b.qualityIndex;

			// Sort by indexers (lower index = higher priority)
			if (a.indexerIndex !== b.indexerIndex) return a.indexerIndex - b.indexerIndex;

			// Sort by size (descending)
			return (b.size || 0) - (a.size || 0);
		})
		.map(({ qualityIndex, indexerIndex, ...rest }) => rest); // remove temporary field
};

const formatBytes = (bytes: number): string => {
	if (bytes >= 1024 ** 3) {
		// GB
		return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	} else if (bytes >= 1024 ** 2) {
		// MB
		return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	} else if (bytes >= 1024) {
		// KB
		return `${(bytes / 1024).toFixed(1)} KB`;
	} else {
		return `${bytes} B`;
	}
};

const generateDescription = (torrent: TorrentDataType): string => {
	const sizeText = formatBytes(torrent.size);

	return `
	🎬 ${torrent.title}
	💾 Size: ${sizeText}
	⚙️ From: ${torrent.jackettindexer}
	`;
};

export const isMovie = (data: OMDBDataType): data is OMDBMovieDataType => {
	return data.Type === "movie";
};

export const isSeries = (data: OMDBDataType): data is OMDBSeriesDataType => {
	return data.Type === "series";
};

export const isAnime = (data: OMDBDataType): data is OMDBSeriesDataType => {
	const isInAnimeCountry = animeCountries.some((country) => data.Country.includes(country));
	const isAnimation = data.Genre.includes("Animation");

	return data.Type === "series" && isAnimation && isInAnimeCountry;
};

export const somethingWentWrong = (res: Response) => {
	logger.error({ msg: "❌ Something went wrong." });

	return res.redirect(`http://localhost:${PORT}/public/something_went_wrong.mp4`);
};

export const buildTorrentArray = (torrents: Array<JackettTorrentDataType>): Array<TorrentDataType> => {
	const torrentsWithQuality: Array<TorrentDataType> = torrents.map((item) => {
		const quality = extractQuality(item.title);

		return {
			...item,
			quality,
		};
	});

	const sortedTorrents = sortByIndexerQualityAndSize(torrentsWithQuality);

	return sortedTorrents;
};

export const generateCustomStreams = (torrents: Array<TorrentDataType>): Stream[] => {
	return torrents.map((torrent) => {
		// Encode the magnet link to safely include in URL
		const encodedMagnet = encodeURIComponent(torrent.guid || "");

		return {
			name: `Debridify (${getQualityText(torrent.quality)})`,
			description: generateDescription(torrent),
			url: `http://localhost:${PORT}/resolve?magnet=${encodedMagnet}`,
		};
	});
};
