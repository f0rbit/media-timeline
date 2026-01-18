import { configureErrorLogging, type ErrorLogEntry } from "@media/schema";

const serverErrorLogger = ({ error, context }: ErrorLogEntry) => {
	console.error(`[SSR] [${error.kind}] ${error.message || ""}`, {
		error,
		timestamp: context.timestamp,
	});
};

export const initializeServerErrorLogging = () => {
	configureErrorLogging({
		logger: serverErrorLogger,
		contextProvider: () => ({
			environment: "ssr",
		}),
	});
};
