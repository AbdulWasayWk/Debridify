export type QualityKey = "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";

export interface OMDBMovieDataType {
	Title: string;
	Year: string;
	Rated: string;
	Released: string;
	Runtime: string;
	Genre: string;
	Director: string;
	Writer: string;
	Actors: string;
	Plot: string;
	Language: string;
	Country: string;
	Awards: string;
	Poster: string;
	Ratings: Array<{ Source: string; Value: string }>;
	Metascore: string;
	imdbRating: string;
	imdbVotes: string;
	imdbID: string;
	Type: "movie" | "series";
	DVD: string;
	BoxOffice: string;
	Production: string;
	Website: string;
	Response: string;
}

export interface OMDBSeriesDataType {
	Title: string;
	Year: string;
	Rated: string;
	Released: string;
	Runtime: string;
	Genre: string;
	Director: string;
	Writer: string;
	Actors: string;
	Plot: string;
	Language: string;
	Country: string;
	Awards: string;
	Poster: string;
	Ratings: Array<{ Source: string; Value: string }>;
	Metascore: string;
	imdbRating: string;
	imdbVotes: string;
	imdbID: string;
	Type: "movie" | "series";
	totalSeasons: number;
	Response: string;
}

export type OMDBDataType = OMDBMovieDataType | OMDBSeriesDataType;

export interface AddMagnetDataType {
	id: string;
	uri: string;
}

export interface RealDebridInfoDataType {
	id: string;
	filename: string;
	original_filename: string;
	hash: string;
	bytes: number;
	original_bytes: number;
	host: string;
	split: number;
	progress: number;
	status:
		| "magnet_error"
		| "magnet_conversion"
		| "waiting_files_selection"
		| "queued"
		| "downloading"
		| "downloaded"
		| "error"
		| "virus"
		| "compressing"
		| "uploading"
		| "dead";
	added: string;
	files: Array<{
		id: number;
		path: string;
		bytes: number;
		selected: number;
	}>;
	links: Array<string>;
	ended: string;
	speed: number;
	seeders: number;
}

export interface RealDebridUnrestrictDataType {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	chunks: number;
	crc: number;
	download: string;
	streamable: number;
}

export type CacheItem = { url: string; expiresAt: number };

export interface RealDebridDownloadListDataType {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	chunks: number;
	download: string;
	generated: string;
	type: string;
}

export interface JackettResponseType {
	"?xml": string;
	rss: {
		channel: {
			"atom:link": string;
			title: string;
			description: string;
			link: string;
			language: string;
			category: string;
			item: Array<JackettTorrentDataType>;
		};
	};
}

export interface JackettTorrentDataType {
	title: string;
	guid: string;
	jackettindexer: string;
	type: string;
	comments: string;
	pubDate: string;
	size: number;
	description: string;
	link: string;
	category: Array<number>;
	enclosure: string;
	"torznab:attr": Array<string>;
}

export interface TorrentDataType {
	title: string;
	guid: string;
	jackettindexer: string;
	type: string;
	comments: string;
	pubDate: string;
	size: number;
	description: string;
	link: string;
	category: Array<number>;
	enclosure: string;
	quality: string | null;
	"torznab:attr": Array<string>;
}

export interface AnilistAnimeDataType {
	id: number;
	title: {
		romaji: string | null;
		english: string | null;
		native: string | null;
	};
	episodes: number;
}
