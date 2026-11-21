import pino from "pino";
import { env } from "../config.js";

export const logger = pino({
	level: env.logLevel,
	base: undefined,
	redact: { paths: ["*.token", "*.apikey", "*.apiKey", "*.authorization"], censor: "[redacted]" },
	// Human-readable logs for `docker compose logs`; set LOG_PRETTY=false for raw JSON.
	...(env.logPretty
		? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } }
		: {}),
});

export default logger;
