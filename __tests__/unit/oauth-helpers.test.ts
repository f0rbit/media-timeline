import { describe, expect, it } from "bun:test";
import { type DecodeStateError, type OAuthState, type TokenValidationError, type ValidatedTokens, calculateTokenExpiry, decodeOAuthStateData, validateTokenResponse } from "../../src/oauth-helpers";

describe("decodeOAuthStateData", () => {
	const encodeState = <T extends Record<string, unknown>>(data: T): string => btoa(JSON.stringify(data));

	describe("success cases", () => {
		it("decodes valid state with user_id and profile_id", () => {
			const state = encodeState({ user_id: "u1", profile_id: "p1", nonce: "abc" });
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.user_id).toBe("u1");
				expect(result.value.profile_id).toBe("p1");
				expect(result.value.nonce).toBe("abc");
			}
		});

		it("decodes state with extra fields", () => {
			const state = encodeState({
				user_id: "u1",
				profile_id: "p1",
				nonce: "abc",
				custom_field: "custom_value",
			});
			const result = decodeOAuthStateData<{ custom_field: string }>(state);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.custom_field).toBe("custom_value");
			}
		});

		it("validates required keys when present", () => {
			const state = encodeState({
				user_id: "u1",
				profile_id: "p1",
				nonce: "abc",
				repo: "owner/repo",
			});
			const result = decodeOAuthStateData<{ repo: string }>(state, ["repo"]);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.repo).toBe("owner/repo");
			}
		});
	});

	describe("error cases", () => {
		it("returns no_state error for undefined state", () => {
			const result = decodeOAuthStateData(undefined);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("no_state");
			}
		});

		it("returns invalid_base64 error for malformed base64", () => {
			const result = decodeOAuthStateData("not-valid-base64!!!");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_base64");
			}
		});

		it("returns invalid_json error for valid base64 but invalid JSON", () => {
			const state = btoa("not json at all");
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_json");
			}
		});

		it("returns missing_user_id error when user_id is missing", () => {
			const state = encodeState({ profile_id: "p1", nonce: "abc" });
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_user_id");
			}
		});

		it("returns missing_user_id error when user_id is empty", () => {
			const state = encodeState({ user_id: "", profile_id: "p1", nonce: "abc" });
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_user_id");
			}
		});

		it("returns missing_profile_id error when profile_id is missing", () => {
			const state = encodeState({ user_id: "u1", nonce: "abc" });
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_profile_id");
			}
		});

		it("returns missing_profile_id error when profile_id is empty", () => {
			const state = encodeState({ user_id: "u1", profile_id: "", nonce: "abc" });
			const result = decodeOAuthStateData(state);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_profile_id");
			}
		});

		it("returns missing_required_key error when required key is missing", () => {
			const state = encodeState({ user_id: "u1", profile_id: "p1", nonce: "abc" });
			const result = decodeOAuthStateData<{ repo: string }>(state, ["repo"]);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_required_key");
				expect((result.error as { kind: "missing_required_key"; key: string }).key).toBe("repo");
			}
		});

		it("returns missing_required_key error when required key is empty", () => {
			const state = encodeState({
				user_id: "u1",
				profile_id: "p1",
				nonce: "abc",
				repo: "",
			});
			const result = decodeOAuthStateData<{ repo: string }>(state, ["repo"]);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_required_key");
			}
		});
	});
});

describe("calculateTokenExpiry", () => {
	const fixedNow = new Date("2024-01-15T12:00:00.000Z");

	describe("with expires_in", () => {
		it("calculates expiry for 3600 seconds (1 hour)", () => {
			const result = calculateTokenExpiry(3600, fixedNow);

			expect(result).toBe("2024-01-15T13:00:00.000Z");
		});

		it("calculates expiry for 86400 seconds (24 hours)", () => {
			const result = calculateTokenExpiry(86400, fixedNow);

			expect(result).toBe("2024-01-16T12:00:00.000Z");
		});

		it("handles small values (1 second)", () => {
			const result = calculateTokenExpiry(1, fixedNow);

			expect(result).toBe("2024-01-15T12:00:01.000Z");
		});

		it("handles zero value", () => {
			const result = calculateTokenExpiry(0, fixedNow);

			expect(result).toBeNull();
		});
	});

	describe("without expires_in", () => {
		it("returns null for undefined", () => {
			const result = calculateTokenExpiry(undefined, fixedNow);

			expect(result).toBeNull();
		});
	});

	describe("default now behavior", () => {
		it("uses current time when now is not provided", () => {
			const before = Date.now();
			const result = calculateTokenExpiry(3600);
			const after = Date.now();

			expect(result).not.toBeNull();
			if (result) {
				const resultTime = new Date(result).getTime();
				expect(resultTime).toBeGreaterThanOrEqual(before + 3600 * 1000);
				expect(resultTime).toBeLessThanOrEqual(after + 3600 * 1000);
			}
		});
	});
});

describe("validateTokenResponse", () => {
	describe("success cases", () => {
		it("validates minimal valid response", () => {
			const response = {
				access_token: "token123",
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.access_token).toBe("token123");
				expect(result.value.token_type).toBe("Bearer");
			}
		});

		it("validates full response with all fields", () => {
			const response = {
				access_token: "token123",
				refresh_token: "refresh456",
				expires_in: 3600,
				token_type: "Bearer",
				scope: "read write",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.access_token).toBe("token123");
				expect(result.value.refresh_token).toBe("refresh456");
				expect(result.value.expires_in).toBe(3600);
				expect(result.value.token_type).toBe("Bearer");
				expect(result.value.scope).toBe("read write");
			}
		});

		it("accepts lowercase bearer token type", () => {
			const response = {
				access_token: "token123",
				token_type: "bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.token_type).toBe("bearer");
			}
		});

		it("accepts MAC token type", () => {
			const response = {
				access_token: "token123",
				token_type: "MAC",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.token_type).toBe("MAC");
			}
		});

		it("defaults token_type to Bearer when missing", () => {
			const response = {
				access_token: "token123",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.token_type).toBe("Bearer");
			}
		});

		it("ignores non-string refresh_token", () => {
			const response = {
				access_token: "token123",
				refresh_token: 12345,
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.refresh_token).toBeUndefined();
			}
		});

		it("ignores non-number expires_in", () => {
			const response = {
				access_token: "token123",
				expires_in: "3600",
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.expires_in).toBeUndefined();
			}
		});
	});

	describe("error cases", () => {
		it("returns missing_access_token for null response", () => {
			const result = validateTokenResponse(null);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns missing_access_token for undefined response", () => {
			const result = validateTokenResponse(undefined);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns missing_access_token for non-object response", () => {
			const result = validateTokenResponse("not an object");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns missing_access_token when access_token is missing", () => {
			const response = {
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns missing_access_token when access_token is empty string", () => {
			const response = {
				access_token: "",
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns missing_access_token when access_token is not a string", () => {
			const response = {
				access_token: 12345,
				token_type: "Bearer",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("missing_access_token");
			}
		});

		it("returns invalid_token_type for unsupported token type", () => {
			const response = {
				access_token: "token123",
				token_type: "Basic",
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_token_type");
				expect((result.error as { kind: "invalid_token_type"; got: string }).got).toBe("Basic");
			}
		});

		it("returns invalid_token_type when token_type is not a string", () => {
			const response = {
				access_token: "token123",
				token_type: 123,
			};
			const result = validateTokenResponse(response);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_token_type");
			}
		});
	});
});
