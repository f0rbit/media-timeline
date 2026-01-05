export type { NormalizeError, PlatformGroups, PlatformProcessResult, ProcessingError, RawSnapshot } from "../sync/types";

export type CronResult = {
	processed_accounts: number;
	updated_users: string[];
	failed_accounts: string[];
	timelines_generated: number;
};
