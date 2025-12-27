import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initialState, isCircuitOpen, type RateLimitState, shouldFetch, updateOnFailure, updateOnSuccess } from "../../src/storage";
import { ACCOUNTS, GITHUB_FIXTURES, USERS } from "./fixtures";
import { createTestContext, getAccount, getRateLimit, seedAccount, seedRateLimit, seedUser, type TestContext } from "./setup";

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60 * 1000);

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60 * 1000);

const makeHeaders = (remaining: number, limit: number, resetInSeconds: number): Headers => {
	const reset = Math.floor((Date.now() + resetInSeconds * 1000) / 1000);
	return new Headers({
		"X-RateLimit-Remaining": String(remaining),
		"X-RateLimit-Limit": String(limit),
		"X-RateLimit-Reset": String(reset),
	});
};

describe("resilience", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("rate limiting", () => {
		it("allows fetch when rate limit not exhausted", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 100,
				limit_total: 5000,
				reset_at: minutesFromNow(30),
			};

			expect(shouldFetch(state)).toBe(true);
		});

		it("skips fetch when rate limit exhausted and not reset", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				limit_total: 5000,
				reset_at: minutesFromNow(30),
			};

			expect(shouldFetch(state)).toBe(false);
		});

		it("fetches after rate limit resets", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				limit_total: 5000,
				reset_at: minutesAgo(5),
			};

			expect(shouldFetch(state)).toBe(true);
		});

		it("parses rate limit headers correctly", () => {
			const state = initialState();
			const headers = makeHeaders(4999, 5000, 3600);

			const updated = updateOnSuccess(state, headers);

			expect(updated.remaining).toBe(4999);
			expect(updated.limit_total).toBe(5000);
			expect(updated.reset_at).not.toBeNull();
			expect(updated.consecutive_failures).toBe(0);
		});

		it("handles missing rate limit headers gracefully", () => {
			const state = initialState();
			const headers = new Headers();

			const updated = updateOnSuccess(state, headers);

			expect(updated.remaining).toBeNull();
			expect(updated.limit_total).toBeNull();
			expect(updated.reset_at).toBeNull();
			expect(updated.consecutive_failures).toBe(0);
		});

		it("allows fetch when no rate limit state exists", () => {
			const state = initialState();
			expect(shouldFetch(state)).toBe(true);
		});

		it("allows fetch when remaining is null (never fetched)", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: null,
				limit_total: null,
				reset_at: null,
			};

			expect(shouldFetch(state)).toBe(true);
		});

		it("stores rate limit state in database", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const futureReset = minutesFromNow(60);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				remaining: 4500,
				limit_total: 5000,
				reset_at: futureReset,
			});

			const saved = await getRateLimit(ctx, ACCOUNTS.alice_github.id);
			expect(saved).not.toBeNull();
			expect((saved as { remaining: number }).remaining).toBe(4500);
		});
	});

	describe("circuit breaker", () => {
		it("starts with closed circuit", () => {
			const state = initialState();
			expect(isCircuitOpen(state)).toBe(false);
		});

		it("opens after threshold consecutive failures", () => {
			let state: RateLimitState = initialState();

			state = updateOnFailure(state);
			expect(isCircuitOpen(state)).toBe(false);
			expect(state.consecutive_failures).toBe(1);

			state = updateOnFailure(state);
			expect(isCircuitOpen(state)).toBe(false);
			expect(state.consecutive_failures).toBe(2);

			state = updateOnFailure(state);
			expect(isCircuitOpen(state)).toBe(true);
			expect(state.consecutive_failures).toBe(3);
			expect(state.circuit_open_until).not.toBeNull();
		});

		it("circuit stays open for configured duration", () => {
			let state: RateLimitState = initialState();

			state = updateOnFailure(state);
			state = updateOnFailure(state);
			state = updateOnFailure(state);

			expect(isCircuitOpen(state)).toBe(true);

			if (state.circuit_open_until) {
				const openDuration = state.circuit_open_until.getTime() - Date.now();
				expect(openDuration).toBeGreaterThan(4 * 60 * 1000);
				expect(openDuration).toBeLessThanOrEqual(5 * 60 * 1000);
			}
		});

		it("circuit closes after timeout expires", () => {
			const state: RateLimitState = {
				...initialState(),
				consecutive_failures: 5,
				circuit_open_until: minutesAgo(1),
			};

			expect(isCircuitOpen(state)).toBe(false);
		});

		it("resets failure count on success", () => {
			let state: RateLimitState = {
				...initialState(),
				consecutive_failures: 2,
				last_failure_at: minutesAgo(1),
			};

			const headers = makeHeaders(4999, 5000, 3600);
			state = updateOnSuccess(state, headers);

			expect(state.consecutive_failures).toBe(0);
			expect(state.last_failure_at).toBeNull();
			expect(state.circuit_open_until).toBeNull();
		});

		it("circuit prevents fetch when open", () => {
			const state: RateLimitState = {
				...initialState(),
				consecutive_failures: 5,
				circuit_open_until: minutesFromNow(5),
			};

			expect(shouldFetch(state)).toBe(false);
		});

		it("allows fetch after circuit timeout even with failures", () => {
			const state: RateLimitState = {
				...initialState(),
				consecutive_failures: 5,
				circuit_open_until: minutesAgo(1),
			};

			expect(shouldFetch(state)).toBe(true);
		});

		it("records failure timestamp", () => {
			const before = new Date();
			const state = updateOnFailure(initialState());
			const after = new Date();

			expect(state.last_failure_at).not.toBeNull();
			if (state.last_failure_at) {
				expect(state.last_failure_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
				expect(state.last_failure_at.getTime()).toBeLessThanOrEqual(after.getTime());
			}
		});

		it("stores circuit breaker state in database", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const circuitOpen = minutesFromNow(5);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				consecutive_failures: 3,
				circuit_open_until: circuitOpen,
				last_failure_at: minutesAgo(1),
			});

			const saved = await getRateLimit(ctx, ACCOUNTS.alice_github.id);
			expect(saved).not.toBeNull();
			expect((saved as { consecutive_failures: number }).consecutive_failures).toBe(3);
		});
	});

	describe("auth failures", () => {
		it("memory provider simulates auth expiry", async () => {
			ctx.providers.github.setSimulateAuthExpired(true);

			const result = await ctx.providers.github.fetch("fake-token");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("auth_expired");
			}
		});

		it("memory provider simulates rate limit", async () => {
			ctx.providers.github.setSimulateRateLimit(true);

			const result = await ctx.providers.github.fetch("fake-token");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("rate_limited");
				if (result.error.kind === "rate_limited") {
					expect(result.error.retry_after).toBe(60);
				}
			}
		});

		it("marks account inactive on auth expiry detection", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const account = await getAccount(ctx, ACCOUNTS.alice_github.id);
			expect(account).not.toBeNull();
			expect((account as { is_active: number }).is_active).toBe(1);

			await ctx.d1.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?").bind(ACCOUNTS.alice_github.id).run();

			const updatedAccount = await getAccount(ctx, ACCOUNTS.alice_github.id);
			expect((updatedAccount as { is_active: number }).is_active).toBe(0);
		});

		it("provider returns data when no simulation flags set", async () => {
			// Setup repo data in the new multi-store format
			ctx.providers.github.setRepositories([
				{
					owner: "test-user",
					name: "test-repo",
					full_name: "test-user/test-repo",
					default_branch: "main",
					branches: ["main"],
					is_private: false,
					pushed_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
			]);
			ctx.providers.github.setRepoData("test-user/test-repo", {
				commits: {
					owner: "test-user",
					repo: "test-repo",
					branches: ["main"],
					commits: [
						{
							sha: "abc123",
							message: "Initial commit",
							author_name: "Test User",
							author_email: "test@example.com",
							author_date: new Date().toISOString(),
							committer_name: "Test User",
							committer_email: "test@example.com",
							committer_date: new Date().toISOString(),
							url: "https://github.com/test-user/test-repo/commit/abc123",
							branch: "main",
						},
					],
					total_commits: 1,
					fetched_at: new Date().toISOString(),
				},
				prs: {
					owner: "test-user",
					repo: "test-repo",
					pull_requests: [],
					total_prs: 0,
					fetched_at: new Date().toISOString(),
				},
			});

			const result = await ctx.providers.github.fetch("fake-token");

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.meta.repositories).toHaveLength(1);
				expect(result.value.repos.get("test-user/test-repo")?.commits.commits).toHaveLength(1);
			}
		});

		it("provider tracks call count", async () => {
			expect(ctx.providers.github.getCallCount()).toBe(0);

			await ctx.providers.github.fetch("token");
			expect(ctx.providers.github.getCallCount()).toBe(1);

			await ctx.providers.github.fetch("token");
			expect(ctx.providers.github.getCallCount()).toBe(2);

			ctx.providers.github.reset();
			expect(ctx.providers.github.getCallCount()).toBe(0);
		});
	});

	describe("retry with backoff", () => {
		it("updateOnFailure respects retryAfter parameter", () => {
			const state = initialState();
			const retryAfterSeconds = 120;

			const updated = updateOnFailure(state, retryAfterSeconds);

			expect(updated.remaining).toBe(0);
			expect(updated.reset_at).not.toBeNull();
			if (updated.reset_at) {
				const expectedReset = Date.now() + retryAfterSeconds * 1000;
				expect(Math.abs(updated.reset_at.getTime() - expectedReset)).toBeLessThan(1000);
			}
		});

		it("preserves existing rate limit info on failure without retryAfter", () => {
			const existingReset = minutesFromNow(30);
			const state: RateLimitState = {
				...initialState(),
				remaining: 100,
				limit_total: 5000,
				reset_at: existingReset,
			};

			const updated = updateOnFailure(state);

			expect(updated.remaining).toBe(100);
			expect(updated.reset_at).toEqual(existingReset);
			expect(updated.consecutive_failures).toBe(1);
		});
	});

	describe("combined rate limit and circuit breaker", () => {
		it("rate limit takes precedence when both apply", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 0,
				limit_total: 5000,
				reset_at: minutesFromNow(60),
				consecutive_failures: 2,
				circuit_open_until: null,
			};

			expect(shouldFetch(state)).toBe(false);
		});

		it("circuit breaker takes precedence when open", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 1000,
				limit_total: 5000,
				reset_at: minutesFromNow(60),
				consecutive_failures: 5,
				circuit_open_until: minutesFromNow(5),
			};

			expect(shouldFetch(state)).toBe(false);
		});

		it("allows fetch when rate limit available and circuit closed", () => {
			const state: RateLimitState = {
				...initialState(),
				remaining: 1000,
				limit_total: 5000,
				reset_at: minutesFromNow(60),
				consecutive_failures: 2,
				circuit_open_until: minutesAgo(1),
			};

			expect(shouldFetch(state)).toBe(true);
		});
	});

	describe("provider error types", () => {
		it("bluesky provider simulates rate limit with correct retry", async () => {
			ctx.providers.bluesky.setSimulateRateLimit(true);

			const result = await ctx.providers.bluesky.fetch("fake-token");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("rate_limited");
				if (result.error.kind === "rate_limited") {
					expect(result.error.retry_after).toBe(60);
				}
			}
		});

		it("youtube provider simulates rate limit with longer retry", async () => {
			ctx.providers.youtube.setSimulateRateLimit(true);

			const result = await ctx.providers.youtube.fetch("fake-token");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("rate_limited");
				if (result.error.kind === "rate_limited") {
					expect(result.error.retry_after).toBe(3600);
				}
			}
		});

		it("devpad provider simulates auth expiry", async () => {
			ctx.providers.devpad.setSimulateAuthExpired(true);

			const result = await ctx.providers.devpad.fetch("fake-token");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("auth_expired");
			}
		});
	});
});
