import path from "path";
import fs from "fs";
import pino from "pino";

const logDir = path.resolve("./logs");

// Create logs folder if it doesn't exist
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true });
}

// Helper to get YYYY-MM-DD format for the file name
const getDateString = () => {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// File path with date
const logFile = path.join(logDir, `${getDateString()}.log`);

let logger: pino.Logger;

if (process.env.LOG_TO_FILE === "true") {
	const transport = pino.transport({
		target: "pino-roll",
		options: {
			file: logFile, // base file name
			frequency: "daily", // rotate daily
			size: "10m", // optional max size before rotation
			keep: 15, // keep last 15 files
		},
	});

	logger = pino(
		{
			timestamp: () => `,"time":"${new Date().toLocaleString()}"`,
		},
		transport,
	);
} else {
	logger = pino();
}

export default logger;
