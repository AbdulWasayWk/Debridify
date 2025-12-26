import { getRouter } from "@stremio-addon/node-express";
import { AddonBuilder, type DefaultConfig, type Manifest, type StreamHandlerArgs } from "@stremio-addon/sdk";
import "dotenv/config";
import express from "express";
import { searchMovieTorrents, searchSeriesTorrents } from "./apiFunctions/jackett.ts";
import { getMediaDetailsFromOmdb } from "./apiFunctions/omdb.ts";
import { resolveMagnetThroughRealDebrid } from "./apiFunctions/resolver.ts";
import { generateCustomStreams, isMovie, isSeries } from "./helpers/helpers.ts";
import logger from "./helpers/logger.ts";

const manifest: Manifest = {
	id: "com.AbdulWasayWk.Debridify",
	version: "1.0.0",
	name: "Debridify",
	description: "Local Stremio addon for direct Real-Debrid streams",
	resources: ["stream"],
	types: ["movie", "series"],
	catalogs: [],
};

const builder = new AddonBuilder(manifest);

const handleMovies = async (args: StreamHandlerArgs<DefaultConfig>) => {
	const imdbId = args.id;

	const movieDetails = await getMediaDetailsFromOmdb(imdbId);

	if (movieDetails && isMovie(movieDetails)) {
		const torrents = await searchMovieTorrents(movieDetails);

		if (torrents && torrents.length) {
			const streams = generateCustomStreams(torrents);

			return { streams };
		}
	}

	return { streams: [] };
};

const handleSeries = async (args: StreamHandlerArgs<DefaultConfig>) => {
	const [imdbId, season, episode] = args.id.split(":");

	if (imdbId && season && episode) {
		const seriesDetails = await getMediaDetailsFromOmdb(imdbId);

		if (seriesDetails && isSeries(seriesDetails)) {
			const torrents = await searchSeriesTorrents(seriesDetails, season, episode);

			if (torrents && torrents.length) {
				const streams = generateCustomStreams(torrents);

				return { streams };
			}
		}
	}

	return { streams: [] };
};

// Stream handler
builder.defineStreamHandler(async (args) => {
	logger.info({ msg: "Selected Item", args });

	switch (args.type) {
		case "movie":
			return await handleMovies(args);

		case "series":
			return handleSeries(args);

		default:
			return { streams: [] };
	}
});

const addonInterface = builder.getInterface();

// Simple express app
const app = express();

// Mount the addon router using the stremio express library
app.use(getRouter(addonInterface));

// Public to access video file
app.use("/public", express.static("public"));

// Endpoint for getting the stream from real-debrid
app.get("/resolve", resolveMagnetThroughRealDebrid);

// Start the server
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;
app.listen(PORT, "0.0.0.0", () => {
	logger.info({ msg: `✅ Addon Started` });
	logger.info({ msg: `Addon available at http://<host-ip>:${PORT}/manifest.json` });
});
