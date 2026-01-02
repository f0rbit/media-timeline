import type { StoreType } from "../connection-delete";
import { PLATFORMS, type Platform } from "../schema/platforms";

export interface PlatformCapabilities {
	/** Whether this platform uses multi-store architecture (meta + content stores) */
	hasMultiStore: boolean;
	/** Minimum days between fetches (undefined = fetch every time) */
	fetchIntervalDays?: number;
	/** Store types used by this platform */
	storeTypes: readonly StoreType[];
	/** Human-readable display name */
	displayName: string;
	/** Whether OAuth is supported */
	hasOAuth: boolean;
}

export const PLATFORM_REGISTRY: Record<Platform, PlatformCapabilities> = {
	github: {
		hasMultiStore: true,
		storeTypes: ["github_meta", "github_commits", "github_prs"],
		displayName: "GitHub",
		hasOAuth: true,
	},
	reddit: {
		hasMultiStore: true,
		storeTypes: ["reddit_meta", "reddit_posts", "reddit_comments"],
		displayName: "Reddit",
		hasOAuth: true,
	},
	twitter: {
		hasMultiStore: true,
		fetchIntervalDays: 3,
		storeTypes: ["twitter_meta", "twitter_tweets"],
		displayName: "Twitter/X",
		hasOAuth: true,
	},
	bluesky: {
		hasMultiStore: false,
		storeTypes: ["raw"],
		displayName: "Bluesky",
		hasOAuth: false,
	},
	youtube: {
		hasMultiStore: false,
		storeTypes: ["raw"],
		displayName: "YouTube",
		hasOAuth: false,
	},
	devpad: {
		hasMultiStore: false,
		storeTypes: ["raw"],
		displayName: "Devpad",
		hasOAuth: false,
	},
} as const;

// Compile-time exhaustiveness check
const _exhaustiveCheck: Record<Platform, PlatformCapabilities> = PLATFORM_REGISTRY;

export const getPlatformCapabilities = (platform: Platform): PlatformCapabilities => PLATFORM_REGISTRY[platform];

export const getPlatformsWithOAuth = (): Platform[] => PLATFORMS.filter(p => PLATFORM_REGISTRY[p].hasOAuth);

export const getPlatformsWithMultiStore = (): Platform[] => PLATFORMS.filter(p => PLATFORM_REGISTRY[p].hasMultiStore);
