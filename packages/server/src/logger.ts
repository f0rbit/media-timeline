/**
 * Simple structured logger with log levels.
 * In production, only info and above are logged.
 * Set LOG_LEVEL=debug for verbose output.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const currentLevel = (): LogLevel => {
	// In Cloudflare Workers, we don't have process.env
	// Default to "info" for production, can be overridden
	return "info";
};

export const createLogger = (namespace: string) => {
	const shouldLog = (level: LogLevel): boolean => {
		return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel()];
	};

	return {
		debug: (...args: unknown[]) => {
			if (shouldLog("debug")) console.log(`[${namespace}]`, ...args);
		},
		info: (...args: unknown[]) => {
			if (shouldLog("info")) console.log(`[${namespace}]`, ...args);
		},
		warn: (...args: unknown[]) => {
			if (shouldLog("warn")) console.warn(`[${namespace}]`, ...args);
		},
		error: (...args: unknown[]) => {
			if (shouldLog("error")) console.error(`[${namespace}]`, ...args);
		},
	};
};

export type Logger = ReturnType<typeof createLogger>;
