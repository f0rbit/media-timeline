export type MediaConfig = {
	// API URLs
	apiUrl: string;
	frontendUrl: string;
	devpadUrl: string;

	// Feature flags
	enableCron: boolean;
	enableOAuth: {
		reddit: boolean;
		twitter: boolean;
		github: boolean;
		youtube: boolean;
	};

	// Rate limiting
	cronIntervalMinutes: number;
	circuitBreakerThreshold: number;
	circuitBreakerCooldownMinutes: number;
};

const defaultConfig: MediaConfig = {
	apiUrl: "http://localhost:8787",
	frontendUrl: "http://localhost:4321",
	devpadUrl: "https://devpad.tools",
	enableCron: true,
	enableOAuth: {
		reddit: true,
		twitter: true,
		github: true,
		youtube: false,
	},
	cronIntervalMinutes: 5,
	circuitBreakerThreshold: 3,
	circuitBreakerCooldownMinutes: 5,
};

let currentConfig: MediaConfig = { ...defaultConfig };

export function configureMedia(overrides: Partial<MediaConfig>): void {
	currentConfig = { ...currentConfig, ...overrides };
}

export function getConfig(): MediaConfig {
	return currentConfig;
}

export function configureFromEnv(env: {
	ENVIRONMENT?: string;
	MEDIA_API_URL?: string;
	MEDIA_FRONTEND_URL?: string;
}): void {
	const isProduction = env.ENVIRONMENT === "production";

	configureMedia({
		apiUrl: env.MEDIA_API_URL ?? (isProduction ? "https://media-api.devpad.tools" : defaultConfig.apiUrl),
		frontendUrl: env.MEDIA_FRONTEND_URL ?? (isProduction ? "https://media.devpad.tools" : defaultConfig.frontendUrl),
	});
}
