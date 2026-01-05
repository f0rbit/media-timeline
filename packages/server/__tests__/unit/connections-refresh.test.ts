import { describe, expect, test } from "bun:test";
import { type CategorizedAccounts, type RefreshAttempt, type RefreshStrategy, aggregateRefreshResults, categorizeAccountsByPlatform, determineRefreshStrategy, shouldRegenerateTimeline } from "@media/server/services/connections";

describe("categorizeAccountsByPlatform", () => {
	type TestAccount = { id: string; platform: string };

	test("categorizes empty array", () => {
		const result = categorizeAccountsByPlatform<TestAccount>([]);
		expect(result).toEqual({
			github: [],
			reddit: [],
			twitter: [],
			other: [],
		});
	});

	test("categorizes single github account", () => {
		const accounts: TestAccount[] = [{ id: "1", platform: "github" }];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(1);
		expect(result.github[0]?.id).toBe("1");
		expect(result.reddit).toHaveLength(0);
		expect(result.twitter).toHaveLength(0);
		expect(result.other).toHaveLength(0);
	});

	test("categorizes single reddit account", () => {
		const accounts: TestAccount[] = [{ id: "2", platform: "reddit" }];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(0);
		expect(result.reddit).toHaveLength(1);
		expect(result.reddit[0]?.id).toBe("2");
		expect(result.twitter).toHaveLength(0);
		expect(result.other).toHaveLength(0);
	});

	test("categorizes single twitter account", () => {
		const accounts: TestAccount[] = [{ id: "3", platform: "twitter" }];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(0);
		expect(result.reddit).toHaveLength(0);
		expect(result.twitter).toHaveLength(1);
		expect(result.twitter[0]?.id).toBe("3");
		expect(result.other).toHaveLength(0);
	});

	test("categorizes unknown platform to other", () => {
		const accounts: TestAccount[] = [{ id: "4", platform: "bluesky" }];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(0);
		expect(result.reddit).toHaveLength(0);
		expect(result.twitter).toHaveLength(0);
		expect(result.other).toHaveLength(1);
		expect(result.other[0]?.id).toBe("4");
	});

	test("categorizes mixed platforms", () => {
		const accounts: TestAccount[] = [
			{ id: "1", platform: "github" },
			{ id: "2", platform: "reddit" },
			{ id: "3", platform: "twitter" },
			{ id: "4", platform: "github" },
			{ id: "5", platform: "youtube" },
			{ id: "6", platform: "bluesky" },
		];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(2);
		expect(result.reddit).toHaveLength(1);
		expect(result.twitter).toHaveLength(1);
		expect(result.other).toHaveLength(2);
	});

	test("preserves original object properties", () => {
		type ExtendedAccount = { id: string; platform: string; token: string };
		const accounts: ExtendedAccount[] = [{ id: "1", platform: "github", token: "secret123" }];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github[0]?.token).toBe("secret123");
	});

	test("all platforms go to other when unrecognized", () => {
		const accounts: TestAccount[] = [
			{ id: "1", platform: "mastodon" },
			{ id: "2", platform: "linkedin" },
			{ id: "3", platform: "instagram" },
		];
		const result = categorizeAccountsByPlatform(accounts);
		expect(result.github).toHaveLength(0);
		expect(result.reddit).toHaveLength(0);
		expect(result.twitter).toHaveLength(0);
		expect(result.other).toHaveLength(3);
	});
});

describe("determineRefreshStrategy", () => {
	test("returns github for github platform", () => {
		expect(determineRefreshStrategy("github")).toBe("github");
	});

	test("returns reddit for reddit platform", () => {
		expect(determineRefreshStrategy("reddit")).toBe("reddit");
	});

	test("returns twitter for twitter platform", () => {
		expect(determineRefreshStrategy("twitter")).toBe("twitter");
	});

	test("returns generic for unknown platforms", () => {
		expect(determineRefreshStrategy("bluesky")).toBe("generic");
		expect(determineRefreshStrategy("youtube")).toBe("generic");
		expect(determineRefreshStrategy("mastodon")).toBe("generic");
		expect(determineRefreshStrategy("")).toBe("generic");
	});

	test("is case sensitive", () => {
		expect(determineRefreshStrategy("GitHub")).toBe("generic");
		expect(determineRefreshStrategy("GITHUB")).toBe("generic");
		expect(determineRefreshStrategy("Reddit")).toBe("generic");
		expect(determineRefreshStrategy("Twitter")).toBe("generic");
	});
});

describe("aggregateRefreshResults", () => {
	test("handles empty attempts array", () => {
		const result = aggregateRefreshResults([]);
		expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] });
	});

	test("handles all successful attempts", () => {
		const attempts: RefreshAttempt[] = [
			{ accountId: "1", success: true },
			{ accountId: "2", success: true },
			{ accountId: "3", success: true },
		];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 3, failed: 0, errors: [] });
	});

	test("handles all failed attempts", () => {
		const attempts: RefreshAttempt[] = [
			{ accountId: "1", success: false, error: "Network error" },
			{ accountId: "2", success: false, error: "Auth failed" },
		];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 0, failed: 2, errors: ["Network error", "Auth failed"] });
	});

	test("handles mixed success and failure", () => {
		const attempts: RefreshAttempt[] = [
			{ accountId: "1", success: true },
			{ accountId: "2", success: false, error: "Timeout" },
			{ accountId: "3", success: true },
			{ accountId: "4", success: false, error: "Rate limited" },
		];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 2, failed: 2, errors: ["Timeout", "Rate limited"] });
	});

	test("handles failed attempt without error message", () => {
		const attempts: RefreshAttempt[] = [{ accountId: "1", success: false }];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 0, failed: 1, errors: [] });
	});

	test("preserves error order", () => {
		const attempts: RefreshAttempt[] = [
			{ accountId: "1", success: false, error: "First" },
			{ accountId: "2", success: false, error: "Second" },
			{ accountId: "3", success: false, error: "Third" },
		];
		const result = aggregateRefreshResults(attempts);
		expect(result.errors).toEqual(["First", "Second", "Third"]);
	});

	test("handles single success", () => {
		const attempts: RefreshAttempt[] = [{ accountId: "1", success: true }];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 1, failed: 0, errors: [] });
	});

	test("handles single failure with error", () => {
		const attempts: RefreshAttempt[] = [{ accountId: "1", success: false, error: "Connection refused" }];
		const result = aggregateRefreshResults(attempts);
		expect(result).toEqual({ succeeded: 0, failed: 1, errors: ["Connection refused"] });
	});
});

describe("shouldRegenerateTimeline", () => {
	test("returns false for 0 succeeded", () => {
		expect(shouldRegenerateTimeline(0)).toBe(false);
	});

	test("returns true for 1 succeeded", () => {
		expect(shouldRegenerateTimeline(1)).toBe(true);
	});

	test("returns true for many succeeded", () => {
		expect(shouldRegenerateTimeline(5)).toBe(true);
		expect(shouldRegenerateTimeline(100)).toBe(true);
		expect(shouldRegenerateTimeline(1000)).toBe(true);
	});

	test("returns false for negative (edge case)", () => {
		expect(shouldRegenerateTimeline(-1)).toBe(false);
	});
});
