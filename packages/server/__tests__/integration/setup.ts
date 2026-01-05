import type { Platform } from "@media/schema";
import type { GitHubRaw as LegacyGitHubRaw } from "@media/schema";
import { unwrap as assertResultOk, unwrap_err as assertResultErr } from "@media/server/utils";
import type { TestContext } from "../helpers/types";
import { setupGitHubProvider as setupGitHubProviderInternal, type TestProviders } from "../helpers/providers";

export {
	createTestContext,
	type TestContext,
	type TestEnv,
} from "../helpers/context";

export { createTestCorpus, type TestCorpus } from "../helpers/corpus";

export {
	encryptToken,
	getAccount,
	getProfileAccounts,
	getRateLimit,
	getUser,
	getUserAccounts,
	hash_api_key,
	seedAccount,
	seedApiKey,
	seedProfile,
	seedProfileFilter,
	seedRateLimit,
	seedUser,
	seedUserWithProfile,
	type AccountSeed,
	type ProfileFilterSeed,
	type ProfileSeed,
	type RateLimitSeed,
	type UserSeed,
} from "../helpers/database";

export {
	createAppContextWithProviders,
	createGitHubProviderFromAccounts,
	createGitHubProviderFromLegacyAccounts,
	createProviderFactoryByAccountId,
	createProviderFactoryByToken,
	createProviderFactoryFromAccounts,
	createProviderFactoryFromData,
	createTestProviders,
	defaultTestProviderFactory,
	type ProviderDataByToken,
	type TestProviders,
} from "../helpers/providers";

export { createTestApp } from "../helpers/app";

export { assertResultOk, assertResultErr };
export type { Platform };

export const setupGitHubProvider = (ctx: TestContext, data: LegacyGitHubRaw): void => {
	setupGitHubProviderInternal(ctx.providers, data);
};
