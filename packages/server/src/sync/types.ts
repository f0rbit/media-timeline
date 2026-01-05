export type { AccountWithUser } from "../platforms/registry";

export type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

export type NormalizeError = {
	kind: "parse_error";
	platform: string;
	message: string;
};

export type PlatformGroups = {
	github: RawSnapshot[];
	reddit: RawSnapshot[];
	twitter: RawSnapshot[];
	other: RawSnapshot[];
};

export type PlatformProcessResult = {
	meta_version: string;
	stats: Record<string, unknown>;
};

export type ProcessingError = {
	kind: string;
	message?: string;
};
