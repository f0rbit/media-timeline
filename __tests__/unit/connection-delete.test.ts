import { describe, expect, it } from "bun:test";
import { type DeletionAttempt, type StoreType, isValidStoreType, summarizeDeletions, validateAccountOwnership } from "../../src/connection-delete";

describe("validateAccountOwnership", () => {
	const userId = "user-123";

	it("returns not_found when account is null", () => {
		const result = validateAccountOwnership(null, userId);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("not_found");
		}
	});

	it("returns forbidden when user_id does not match", () => {
		const account = { user_id: "other-user", id: "acc-1", name: "Test" };
		const result = validateAccountOwnership(account, userId);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("forbidden");
			expect(result.error).toHaveProperty("message", "You do not own this account");
		}
	});

	it("returns account when user_id matches", () => {
		const account = { user_id: userId, id: "acc-1", platform: "github" };
		const result = validateAccountOwnership(account, userId);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(account);
			expect(result.value.id).toBe("acc-1");
		}
	});

	it("works with any object containing user_id", () => {
		const account = { user_id: userId, extra: "data", nested: { value: 42 } };
		const result = validateAccountOwnership(account, userId);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.extra).toBe("data");
		}
	});
});

describe("summarizeDeletions", () => {
	it("returns zero counts for empty array", () => {
		const result = summarizeDeletions([]);

		expect(result).toEqual({ deleted: 0, failed: 0 });
	});

	it("counts all successful deletions", () => {
		const attempts: DeletionAttempt[] = [
			{ success: true, version: "v1" },
			{ success: true, version: "v2" },
			{ success: true, version: "v3" },
		];

		const result = summarizeDeletions(attempts);

		expect(result).toEqual({ deleted: 3, failed: 0 });
	});

	it("counts all failed deletions", () => {
		const attempts: DeletionAttempt[] = [
			{ success: false, error: "timeout" },
			{ success: false, error: "not found" },
		];

		const result = summarizeDeletions(attempts);

		expect(result).toEqual({ deleted: 0, failed: 2 });
	});

	it("counts mixed success and failure", () => {
		const attempts: DeletionAttempt[] = [
			{ success: true, version: "v1" },
			{ success: false, error: "timeout" },
			{ success: true, version: "v2" },
			{ success: false, error: "not found" },
			{ success: true, version: "v3" },
		];

		const result = summarizeDeletions(attempts);

		expect(result).toEqual({ deleted: 3, failed: 2 });
	});

	it("handles single successful attempt", () => {
		const attempts: DeletionAttempt[] = [{ success: true }];

		const result = summarizeDeletions(attempts);

		expect(result).toEqual({ deleted: 1, failed: 0 });
	});

	it("handles single failed attempt", () => {
		const attempts: DeletionAttempt[] = [{ success: false }];

		const result = summarizeDeletions(attempts);

		expect(result).toEqual({ deleted: 0, failed: 1 });
	});
});

describe("isValidStoreType", () => {
	const validTypes: StoreType[] = ["github_meta", "github_commits", "github_prs", "reddit_meta", "reddit_posts", "reddit_comments", "twitter_meta", "twitter_tweets", "bluesky", "youtube", "devpad", "raw"];

	it.each(validTypes)("returns true for valid type: %s", type => {
		expect(isValidStoreType(type)).toBe(true);
	});

	it("returns false for invalid type", () => {
		expect(isValidStoreType("invalid")).toBe(false);
		expect(isValidStoreType("")).toBe(false);
		expect(isValidStoreType("GITHUB_META")).toBe(false);
		expect(isValidStoreType("github-meta")).toBe(false);
	});

	it("narrows type correctly", () => {
		const maybeType: string = "github_meta";

		if (isValidStoreType(maybeType)) {
			const storeType: StoreType = maybeType;
			expect(storeType).toBe("github_meta");
		} else {
			throw new Error("Expected type guard to pass");
		}
	});
});
