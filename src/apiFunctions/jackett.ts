import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { buildTorrentArray, delay, indexers, isAnime, pad } from "../helpers/helpers.js";
import logger from "../helpers/logger.js";
import type {
	AnilistAnimeDataType,
	JackettResponseType,
	JackettTorrentDataType,
	OMDBMovieDataType,
	OMDBSeriesDataType,
	TorrentDataType,
} from "../types.js";

const JACKETT_URL = process.env.JACKETT_URL;
const JACKETT_API_KEY = process.env.JACKETT_API_KEY;

const ANILIST_API_URL = "https://graphql.anilist.co";

const xmlParser = new XMLParser();

const getAbsoluteEpisodeNumber = (
	seasons: AnilistAnimeDataType[],
	seasonNumber: number,
	episodeNumber: number,
): number | null => {
	const seasonIndex = seasonNumber - 1;

	// Safety check
	if (!seasons[seasonIndex]) {
		return null;
	}

	// Sum episodes from all previous seasons
	const episodesBefore = seasons.slice(0, seasonIndex).reduce((sum, s) => sum + (s.episodes ?? 0), 0);

	return episodesBefore + episodeNumber;
};

export const generateAnimeSearchQueries = (
	animeDetails: AnilistAnimeDataType,
	allSeasons: AnilistAnimeDataType[],
	season: string,
	episode: string,
): string[] => {
	const seasonNum = Number(season);
	const episodeNum = Number(episode);

	// Absolute episode number
	const absoluteEpisode = getAbsoluteEpisodeNumber(allSeasons, seasonNum, episodeNum);

	// Include all possible titles (romaji, english)
	const titles = [animeDetails.title.romaji, animeDetails.title.english];

	const queries: string[] = [];

	titles.forEach((title) => {
		if (!title) return;

		// 1️⃣ Standard season-based queries
		queries.push(`${title} S${pad(season)}E${pad(episode)}`);
		queries.push(`${title} Season ${pad(season)} Episode ${pad(episode)}`);
		queries.push(`${title} S${season}E${episode}`);
		queries.push(`${title} S${season} - ${episode}`);
		queries.push(`${title} Season ${season} Episode ${episode}`);

		// 2️⃣ Absolute episode queries (scene-style)
		if (absoluteEpisode !== null) {
			queries.push(`${title} ${absoluteEpisode}`); // plain absolute
			queries.push(`${title} Episode ${absoluteEpisode}`); // Episode N
			queries.push(`${title} - ${pad(absoluteEpisode, 3)}`); // zero-padded 3 digits
			queries.push(`${title} ${pad(absoluteEpisode, 3)}`); // zero-padded without dash
		}
	});

	// Deduplicate queries
	return Array.from(new Set(queries));
};

const generateAnimeSearchQueryForAniList = (seriesDetails: OMDBSeriesDataType, season: string) => {
	return Number(season) > 1 ? `${seriesDetails.Title} Season ${season}` : `${seriesDetails.Title}`;
};

const fetchAnimeById = async (id: number) => {
	// GraphQL query: fetch only what we actually need
	const query = `
    query ($id: Int!) {
      Media(id: $id, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        episodes
		type
        format
        relations {
          edges {
            relationType
            node {
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
      }
    }
  `;

	// Make a POST request to AniList GraphQL API
	const response = await axios.post(
		ANILIST_API_URL,
		{
			query,
			variables: { id },
		},
		{
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				// User-Agent is recommended by AniList to avoid aggressive throttling
				"User-Agent": "Debridify/1.0",
			},
		},
	);

	// Basic safety check (helps with debugging unexpected API issues)
	if (!response.data?.data?.Media) {
		throw new Error(`AniList returned no data for anime ID ${id}`);
	}

	// Return strongly typed anime object
	return response.data.data.Media as AnilistAnimeDataType;
};

const getFirstSeason = async (startId: number): Promise<AnilistAnimeDataType> => {
	let current = await fetchAnimeById(startId);

	while (true) {
		// Look for a PREQUEL relation
		const prequelEdge = current.relations.edges.find((edge) => edge.relationType === "PREQUEL");

		// If no prequel exists, this is the first season
		if (!prequelEdge) {
			return current;
		}

		// Small delay to avoid rate limiting
		await delay(600);

		// Move to the prequel anime
		current = await fetchAnimeById(prequelEdge.node.id);
	}
};

const getAllSeasons = async (startAnimeId: number): Promise<AnilistAnimeDataType[]> => {
	const seasons: AnilistAnimeDataType[] = [];

	// Step 1: find the very first season
	let current = await getFirstSeason(startAnimeId);

	while (true) {
		// Add the current season to the list
		seasons.push(current);

		// Look for a SEQUEL relation
		const sequelEdge = current.relations.edges.find((edge) => edge.relationType === "SEQUEL");

		// If no sequel exists, we reached the final season
		if (!sequelEdge) {
			break;
		}

		// Small delay to avoid AniList 429s
		await delay(600);

		// Move to the next season
		current = await fetchAnimeById(sequelEdge.node.id);
	}

	return seasons;
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
			type
            format
            relations {
              edges {
                relationType
                node {
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
    	    }
        }
    }
	`;

	const res = await axios.post(
		ANILIST_API_URL,
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
	const allSeasons = await getAllSeasons(animeDetails.id);

	const queries = generateAnimeSearchQueries(animeDetails, allSeasons, season, episode);

	const requests = queries.map((query) =>
		axios.get<JackettResponseType>(
			`${JACKETT_URL}/indexers/all/results/torznab?apikey=${JACKETT_API_KEY}&t=tvsearch&cat=5070&q=${encodeURIComponent(
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

	if (torrents.length) {
		return buildTorrentArray(torrents);
	}

	return null;
};

const handleAnimeSearch = async (seriesDetails: OMDBSeriesDataType, season: string, episode: string) => {
	const fetchedData = await getAnimeInfo(seriesDetails, season);

	await delay(600);

	const anime = fetchedData.find(
		(item) => item.type === "ANIME" && (item.format === "TV" || item.format === "TV_SHORT"),
	);

	if (anime) {
		return await handleAnimeTorrentFetching(anime, season, episode);
	}

	return null;
};

const generateSeriesSearchQuery = (
	seriesDetails: OMDBSeriesDataType,
	season: string | number,
	episode: string | number,
) => {
	return `${seriesDetails.Title} S${pad(season)}E${pad(episode)}`;
};

const filterBySeasonEpisode = (
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
