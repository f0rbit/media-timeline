import { configureErrorLogging, type ErrorLogEntry } from "@media/schema";

const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const getUserId = (): string | undefined => {
	if (typeof window === "undefined") return undefined;
	try {
		const user = localStorage.getItem("user");
		if (user) {
			const parsed = JSON.parse(user);
			return parsed.id || parsed.user_id;
		}
	} catch {
		// ignore
	}
	return undefined;
};

const clientErrorLogger = ({ error, context }: ErrorLogEntry) => {
	console.error(`%c[${error.kind}]%c ${error.message || ""}`, "color: #ff6b6b; font-weight: bold", "color: inherit", {
		error,
		context: {
			...context,
			sessionId,
			url: typeof window !== "undefined" ? window.location.href : undefined,
		},
	});

	if (typeof window !== "undefined" && import.meta.env.PROD) {
		// Example: send to error reporting endpoint
		// Uncomment and configure as needed:
		/*
		fetch("/api/errors", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				error,
				context: {
					...context,
					sessionId,
					url: window.location.href,
					userAgent: navigator.userAgent,
				},
			}),
		}).catch(() => {}); // Fire and forget
		*/
	}
};

export const initializeErrorLogging = () => {
	configureErrorLogging({
		logger: clientErrorLogger,
		contextProvider: () => ({
			sessionId,
			userId: getUserId(),
			url: typeof window !== "undefined" ? window.location.pathname : undefined,
		}),
	});
};

initializeErrorLogging();
