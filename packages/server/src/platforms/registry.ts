import type { Backend } from "@f0rbit/corpus";
import { PLATFORMS, type AccountWithUser, type Platform, type TimelineItem } from "@media/schema";
import type { StoreType } from "../connection-delete";
import type { AppContext } from "../infrastructure/context";
import type { Result } from "../utils";

export type LoadFunction<T = unknown> = (backend: Backend, accountId: string) => Promise<T>;
export type NormalizeFunction<T = unknown> = (data: T, username?: string) => TimelineItem[];

type PlatformProcessResult = {
	meta_version: string;
	stats: Record<string, unknown>;
};

export type CronProcessor = {
	shouldFetch: (account: AccountWithUser, lastFetchedAt: string | null) => boolean;
	createProvider: (ctx: AppContext) => unknown;
	processAccount: (backend: Backend, accountId: string, token: string, provider: unknown, account?: AccountWithUser) => Promise<Result<PlatformProcessResult, { kind: string; message?: string }>>;
};

export interface PlatformConfig {
	hasMultiStore: boolean;
	fetchIntervalDays?: number;
	storeTypes: readonly StoreType[];
	displayName: string;
	hasOAuth: boolean;
}

export const PLATFORM_REGISTRY: Record<Platform, PlatformConfig> = {
	github: {
		hasMultiStore: true,
		storeTypes: ["github_meta", "github_commits", "github_prs"] as const,
		displayName: "GitHub",
		hasOAuth: true,
	},
	reddit: {
		hasMultiStore: true,
		storeTypes: ["reddit_meta", "reddit_posts", "reddit_comments"] as const,
		displayName: "Reddit",
		hasOAuth: true,
	},
	twitter: {
		hasMultiStore: true,
		fetchIntervalDays: 3,
		storeTypes: ["twitter_meta", "twitter_tweets"] as const,
		displayName: "Twitter/X",
		hasOAuth: true,
	},
	bluesky: {
		hasMultiStore: false,
		storeTypes: ["raw"] as const,
		displayName: "Bluesky",
		hasOAuth: false,
	},
	youtube: {
		hasMultiStore: false,
		storeTypes: ["raw"] as const,
		displayName: "YouTube",
		hasOAuth: false,
	},
	devpad: {
		hasMultiStore: false,
		storeTypes: ["raw"] as const,
		displayName: "Devpad",
		hasOAuth: false,
	},
};

const _exhaustiveCheck: Record<Platform, PlatformConfig> = PLATFORM_REGISTRY;

export const getPlatformCapabilities = (platform: Platform): PlatformConfig => PLATFORM_REGISTRY[platform];

export const getPlatformsWithOAuth = (): Platform[] => PLATFORMS.filter(p => PLATFORM_REGISTRY[p].hasOAuth);

export const getPlatformsWithMultiStore = (): Platform[] => PLATFORMS.filter(p => PLATFORM_REGISTRY[p].hasMultiStore);
