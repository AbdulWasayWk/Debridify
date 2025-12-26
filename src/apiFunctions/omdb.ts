import axios from "axios";
import logger from "../helpers/logger";
import type { OMDBDataType } from "../types";

const OMDB_URL = process.env.OMDB_URL;
const OMDB_API_KEY = process.env.OMDB_API_KEY;

const omdbCache: Record<string, OMDBDataType> = {};

// Gets movie details from OMDB
export const getMediaDetailsFromOmdb = async (imdbId: string): Promise<OMDBDataType | null> => {
	try {
		// Return cached data if exists
		const cached = omdbCache[imdbId];
		if (cached) {
			return cached;
		}

		if (OMDB_URL) {
			const response = await axios.get<OMDBDataType>(OMDB_URL, {
				params: {
					i: imdbId,
					apiKey: OMDB_API_KEY,
				},
			});

			if (response.data) {
				omdbCache[imdbId] = response.data;

				return response.data;
			}
		}

		return null;
	} catch (error) {
		logger.error({ msg: "❌ OMDb request failed", error });
		return null;
	}
};
