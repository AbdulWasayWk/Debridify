import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { buildTorrentArray, isAnime } from "../helpers/helpers.ts";
import logger from "../helpers/logger.ts";
import type {
	AnilistAnimeDataType,
	JackettResponseType,
	JackettTorrentDataType,
	OMDBMovieDataType,
	OMDBSeriesDataType,
	TorrentDataType,
} from "../types.ts";

const JACKETT_URL = process.env.JACKETT_URL;
const JACKETT_API_KEY = process.env.JACKETT_API_KEY;

const xmlParser = new XMLParser();

// Gets movie torrents from the Jackett (Locally deployed)
export const searchMovieTorrents = async (movieDetails: OMDBMovieDataType): Promise<Array<TorrentDataType> | null> => {
	try {
		logger.info({ msg: "🎬 Movie Details", movieDetails });

		const data = await axios.get(
			`${JACKETT_URL}/indexers/all/results/torznab?apikey=${JACKETT_API_KEY}&t=movie&q=${encodeURIComponent(movieDetails.Title)}&imdbid=${movieDetails.imdbID}&year=${movieDetails.Year}&limit=50`,
		);

		const jackettResponse: JackettResponseType = xmlParser.parse(data.data);

		if (
			jackettResponse.rss &&
			jackettResponse.rss.channel &&
			jackettResponse.rss.channel.item &&
			jackettResponse.rss.channel.item.length
		) {
			return buildTorrentArray(jackettResponse.rss.channel.item);
		}

		return null;
	} catch (error) {
		logger.error({ msg: "❌ Searching torrent clients failed", error });
		return null;
	}
};

const pad = (n: string | number) => String(n).padStart(2, "0");

const generateSeriesSearchQuery = (
	seriesDetails: OMDBSeriesDataType,
	season: string | number,
	episode: string | number,
) => {
	return `${seriesDetails.Title} S${pad(season)}E${pad(episode)}`;
};

const generateAnimeSearchQuery = (animeDetails: AnilistAnimeDataType, season: string, episode: string) => {
	const title = animeDetails.title.romaji || animeDetails.title.english || animeDetails.title.native;

	return `${title} S${pad(season)}E${pad(episode)}`;
};

const generateAnimeSearchQueryForAniList = (seriesDetails: OMDBSeriesDataType, season: string) => {
	return Number(season) > 1 ? `${seriesDetails.Title} Season ${season}` : `${seriesDetails.Title}`;
};

export const filterBySeasonEpisode = (
	items: Array<JackettTorrentDataType>,
	season: string,
	episode: string,
): Array<JackettTorrentDataType> => {
	const target = `s${pad(season)}e${pad(episode)}`.toLowerCase();

	return items.filter((item) => {
		// Normalize the title: lowercase, remove spaces and dashes
		const normalizedTitle = item.title.toLowerCase().replace(/[\s\-]/g, "");

		return normalizedTitle.includes(target);
	});
};

const getAnimeInfo = async (seriesDetails: OMDBSeriesDataType, season: string) => {
	const query = `
	query ($search: String!) {
  		Page {
    		media(search: $search, type: ANIME) {
      			id
      			title {
        			romaji
        			english
        			native
      			}
				episodes
    		}
  		}
	}
	`;

	const res = await axios.post(
		"https://graphql.anilist.co",
		JSON.stringify({
			query,
			variables: { search: generateAnimeSearchQueryForAniList(seriesDetails, season) },
		}),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		},
	);

	return res.data.data.Page.media as Array<AnilistAnimeDataType>;
};

const handleAnimeTorrentFetching = async (animeDetails: AnilistAnimeDataType, season: string, episode: string) => {
	const query = generateAnimeSearchQuery(animeDetails, season, episode);

	logger.info({ query });

	const indexers = ["nyaasi", "subsplease", "animetosho"];

	const requests = indexers.map((id) =>
		axios.get<JackettResponseType>(
			`${JACKETT_URL}/indexers/${id}/results/torznab?apikey=${JACKETT_API_KEY}&t=tvsearch&cat=5070&q=${encodeURIComponent(
				query,
			)}&limit=33`,
		),
	);

	const results = await Promise.allSettled(requests);

	// Extract success responses only
	const successfulResults = results.filter((r) => r.status === "fulfilled");

	const torrents: Array<JackettTorrentDataType> = [];

	successfulResults.forEach((data) => {
		if (data && data.value && data.value.data) {
			const jackettResponse: JackettResponseType = xmlParser.parse(data.value.data as any);

			if (
				jackettResponse.rss &&
				jackettResponse.rss.channel &&
				jackettResponse.rss.channel.item &&
				jackettResponse.rss.channel.item.length
			) {
				torrents.push(...jackettResponse.rss.channel.item);
			}
		}
	});

	logger.info({ torrents });

	if (torrents.length) {
		return buildTorrentArray(torrents);
	}

	return null;
};

const handleAnimeSearch = async (seriesDetails: OMDBSeriesDataType, season: string, episode: string) => {
	const fetchedData = await getAnimeInfo(seriesDetails, season);
	if (fetchedData && fetchedData[0]) {
		return await handleAnimeTorrentFetching(fetchedData[0], season, episode);
	}

	return null;
};

const handleSeriesSearch = async (seriesDetails: OMDBSeriesDataType, season: string, episode: string) => {
	const query = generateSeriesSearchQuery(seriesDetails, season, episode);

	const results = await axios.get<JackettResponseType>(
		`${JACKETT_URL}/indexers/all/results/torznab?apikey=${JACKETT_API_KEY}&q=${encodeURIComponent(query)}&limit=100`,
	);

	if (results && results.data) {
		const jackettResponse: JackettResponseType = xmlParser.parse(results.data as any);

		if (
			jackettResponse.rss &&
			jackettResponse.rss.channel &&
			jackettResponse.rss.channel.item &&
			jackettResponse.rss.channel.item.length
		) {
			return buildTorrentArray(filterBySeasonEpisode(jackettResponse.rss.channel.item, season, episode));
		}
	}

	return null;
};

// Gets series torrents from the Jackett (Locally deployed)
export const searchSeriesTorrents = async (
	seriesDetails: OMDBSeriesDataType,
	season: string,
	episode: string,
): Promise<Array<TorrentDataType> | null> => {
	try {
		logger.info({ msg: "📺 Series Details", seriesDetails });

		if (isAnime(seriesDetails)) {
			return await handleAnimeSearch(seriesDetails, season, episode);
		} else {
			return await handleSeriesSearch(seriesDetails, season, episode);
		}
	} catch (error) {
		logger.error({ msg: "❌ Searching torrent clients failed", error });
		return null;
	}
};
