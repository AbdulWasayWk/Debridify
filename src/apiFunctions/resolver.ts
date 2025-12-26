import axios from "axios";
import type { Request, Response } from "express";
import logger from "../helpers/logger.js";
import type { AddMagnetDataType, CacheItem, RealDebridInfoDataType, RealDebridUnrestrictDataType } from "../types.js";
import { somethingWentWrong } from "../helpers/helpers.js";

const REAL_DEBRID_API_KEY = process.env.REAL_DEBRID_API_KEY;
const PORT = process.env.PORT;

const resolvedCache: Record<string, CacheItem> = {};

// Cache expiration time in milliseconds (1 hour)
const CACHE_TTL = 60 * 60 * 1000;

const checkIfTorrentExistsInRealDebrid = async (torrentHash: string): Promise<RealDebridInfoDataType | null> => {
	try {
		const torrentsInfoResp = await axios.get<Array<RealDebridInfoDataType>>(
			`https://api.real-debrid.com/rest/1.0/torrents?auth_token=${REAL_DEBRID_API_KEY}`,
		);

		const allTorrents = torrentsInfoResp.data;

		logger.info({ msg: "🔄 Getting all torrents" });
		logger.info({ msg: `🔍 Looking for hash ${torrentHash}` });

		const foundTorrent = allTorrents.find((item) => item.hash === torrentHash);

		if (foundTorrent) {
			return foundTorrent;
		}

		return null;
	} catch (error) {
		logger.error({ msg: "❌ Error looking up existing torrents in real debrid", error });
		// Torrent not found. We will add it
		return null;
	}
};

const addTorrentToRealDebrid = async (magnet: string) => {
	try {
		// Add magnet to Real-Debrid
		const addResponse = await axios.post<AddMagnetDataType>(
			`https://api.real-debrid.com/rest/1.0/torrents/addMagnet?auth_token=${REAL_DEBRID_API_KEY}`,
			`magnet=${encodeURIComponent(magnet)}`,
		);

		logger.info({ msg: "🧲 Added magnet to Real-Debrid", addResponse: addResponse.data });

		const torrentId = addResponse.data.id;

		// Select all files
		await axios.post(
			`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}?auth_token=${REAL_DEBRID_API_KEY}`,
			`files=all`,
		);

		return torrentId;
	} catch (error) {
		logger.error({ msg: "❌ Error adding torrents to real debrid", error });
		return null;
	}
};

const getTorrentIdToUse = async (existingTorrentInfo: RealDebridInfoDataType | null, magnet: string) => {
	if (existingTorrentInfo) {
		logger.info({ msg: "👍 Using existing Real-Debrid torrent", existingTorrentInfo });
		return existingTorrentInfo.id;
	} else {
		const torrentId = await addTorrentToRealDebrid(magnet);

		return torrentId || null;
	}
};

const getCompleteTorrentInfo = async (torrentId: string) => {
	try {
		const infoResp = await axios.get<RealDebridInfoDataType>(
			`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}?auth_token=${REAL_DEBRID_API_KEY}`,
		);
		return infoResp.data;
	} catch (error) {
		logger.error({ msg: "❌ Error getting complete torrent info", error });
		return null;
	}
};

const unrestrictLinkAndGetPlayableVideo = async (completeTorrentInfo: RealDebridInfoDataType) => {
	try {
		// Unrestrict links
		const unrestrictedFilesCalls = completeTorrentInfo.links.map(async (fileLink) =>
			axios.post<RealDebridUnrestrictDataType>(
				`https://api.real-debrid.com/rest/1.0/unrestrict/link?auth_token=${REAL_DEBRID_API_KEY}`,
				`link=${fileLink}`,
			),
		);

		const unrestrictedFiles = (await Promise.all(unrestrictedFilesCalls)).map((item) => item.data);

		// Get video files
		const videoFiles = unrestrictedFiles.filter((file) => file.mimeType.startsWith("video/"));

		if (videoFiles.length === 0) {
			logger.error({ msg: "❌ No playable video files found in this torrent" });
			return null;
		}

		// Return largest video file
		return videoFiles.reduce((prev, curr) => (curr.filesize > prev.filesize ? curr : prev));
	} catch (error) {
		logger.error({ msg: "❌ Error getting complete torrent info", error });
		return null;
	}
};

export const resolveMagnetThroughRealDebrid = async (req: Request, res: Response) => {
	try {
		const magnet = req.query.magnet as string;

		// Checking if magnet exists
		if (!magnet) {
			logger.error({ msg: "❌ Error resolving magnet. Missing magnet link" });
			return somethingWentWrong(res);
		}

		// Return cached link if still valid
		const cached = resolvedCache[magnet];
		if (cached && cached.expiresAt > Date.now()) {
			return res.redirect(cached.url);
		}

		// Compute torrent hash from magnet (Real-Debrid identifies torrents by hash)
		const magnetHashMatch = magnet.match(/urn:btih:([a-fA-F0-9]+)/);
		const torrentHash = magnetHashMatch && magnetHashMatch[1] ? magnetHashMatch[1].toLowerCase() : null;

		// Check if torrent already exists in RD
		const existingTorrentInfo = torrentHash ? await checkIfTorrentExistsInRealDebrid(torrentHash) : null;

		// Get torrent id to use (Either an existing torrent or a newly added one)
		const torrentId = await getTorrentIdToUse(existingTorrentInfo, magnet);

		if (torrentId) {
			// Get complete torrent info
			const completeTorrentInfo = await getCompleteTorrentInfo(torrentId);

			if (completeTorrentInfo === null) {
				return somethingWentWrong(res);
			}

			// If files are cached and ready
			if (completeTorrentInfo.status === "downloaded") {
				logger.info({ msg: "ℹ️ Complete Torrent Info", completeTorrentInfo });

				// Checking if files exist in torrent
				if (!completeTorrentInfo.links || completeTorrentInfo.links.length === 0) {
					logger.error({ msg: "❌ No file links found" });
					return somethingWentWrong(res);
				}

				// Getting video to play
				const mainVideo = await unrestrictLinkAndGetPlayableVideo(completeTorrentInfo);

				if (mainVideo && mainVideo.download) {
					logger.info({ msg: "🎞️ Selected main video file", mainVideo });

					// Cache the download URL with expiration
					resolvedCache[magnet] = { url: mainVideo.download, expiresAt: Date.now() + CACHE_TTL };

					return res.redirect(mainVideo.download);
				} else {
					return somethingWentWrong(res);
				}
			} else {
				logger.info({ msg: `💾 Torrent not cached. Waiting for Real-Debrid to cache torrent ${torrentId}` });
				// Return a video that tells that the torrent is being cached
				return res.redirect(`http://localhost:${PORT}/public/being_cached_message.mp4`);
			}
		} else {
			return somethingWentWrong(res);
		}
	} catch (error) {
		logger.error({ msg: "❌ Error resolving magnet", error });
		return somethingWentWrong(res);
	}
};
