import type { Platform, TimelineItem } from "@media/schema";

export type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

export type RateLimitRow = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number | null;
	circuit_open_until: string | null;
};

export type CronResult = {
	processed_accounts: number;
	updated_users: string[];
	failed_accounts: string[];
	timelines_generated: number;
};

export type NormalizeError = { kind: "parse_error"; platform: string; message: string };

export type PlatformProcessResult = {
	meta_version: string;
	stats: Record<string, unknown>;
};

export type ProcessingError = { kind: string; message?: string };

export type PlatformGroups = {
	github: RawSnapshot[];
	reddit: RawSnapshot[];
	twitter: RawSnapshot[];
	other: RawSnapshot[];
};
