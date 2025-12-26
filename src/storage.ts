import { create_corpus, define_store, json_codec, type Backend, type Store } from "@f0rbit/corpus";
import { z } from "zod";
import { BlueskyRawSchema, DevpadRawSchema, GitHubRawSchema, TimelineSchema, YouTubeRawSchema } from "./schema";
import { err, ok, type Result } from "./utils";

export type CorpusError = { kind: "store_not_found"; store_id: string };

export type RawStoreId = `raw/${string}/${string}`;
export type TimelineStoreId = `timeline/${string}`;
export type StoreId = RawStoreId | TimelineStoreId;

export const rawStoreId = (platform: string, accountId: string): RawStoreId => `raw/${platform}/${accountId}`;
export const timelineStoreId = (userId: string): TimelineStoreId => `timeline/${userId}`;

export const RawDataSchema = z.union([GitHubRawSchema, BlueskyRawSchema, YouTubeRawSchema, DevpadRawSchema]);
export const TimelineDataSchema = TimelineSchema;

export type RawData = z.infer<typeof RawDataSchema>;
export type TimelineData = z.infer<typeof TimelineDataSchema>;

export type RawStore = { store: Store<RawData>; id: RawStoreId };
export type TimelineStore = { store: Store<TimelineData>; id: TimelineStoreId };

export function createRawStore(backend: Backend, platform: string, accountId: string): Result<RawStore, CorpusError> {
	const id = rawStoreId(platform, accountId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(RawDataSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export function createTimelineStore(backend: Backend, userId: string): Result<TimelineStore, CorpusError> {
	const id = timelineStoreId(userId);
	const corpus = create_corpus()
		.with_backend(backend)
		.with_store(define_store(id, json_codec(TimelineDataSchema)))
		.build();

	const store = corpus.stores[id];
	if (!store) {
		return err({ kind: "store_not_found", store_id: id });
	}
	return ok({ store, id });
}

export type RateLimitState = {
	remaining: number | null;
	limit_total: number | null;
	reset_at: Date | null;
	consecutive_failures: number;
	last_failure_at: Date | null;
	circuit_open_until: Date | null;
};

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION_MS = 5 * 60 * 1000;

export const initialState = (): RateLimitState => ({
	remaining: null,
	limit_total: null,
	reset_at: null,
	consecutive_failures: 0,
	last_failure_at: null,
	circuit_open_until: null,
});

export const isCircuitOpen = (state: RateLimitState): boolean => {
	if (!state.circuit_open_until) return false;
	return new Date() < state.circuit_open_until;
};

const isRateLimited = (state: RateLimitState): boolean => {
	if (state.remaining === null) return false;
	if (state.remaining > 0) return false;
	if (!state.reset_at) return false;
	return new Date() < state.reset_at;
};

export const shouldFetch = (state: RateLimitState): boolean => {
	if (isCircuitOpen(state)) return false;
	if (isRateLimited(state)) return false;
	return true;
};

const parseHeader = (headers: Headers, name: string): number | null => {
	const value = headers.get(name);
	if (!value) return null;
	const parsed = parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
};

const parseResetHeader = (headers: Headers): Date | null => {
	const resetTimestamp = parseHeader(headers, "X-RateLimit-Reset");
	if (!resetTimestamp) return null;
	return new Date(resetTimestamp * 1000);
};

export const updateOnSuccess = (_state: RateLimitState, headers: Headers): RateLimitState => ({
	remaining: parseHeader(headers, "X-RateLimit-Remaining"),
	limit_total: parseHeader(headers, "X-RateLimit-Limit"),
	reset_at: parseResetHeader(headers),
	consecutive_failures: 0,
	last_failure_at: null,
	circuit_open_until: null,
});

export const updateOnFailure = (state: RateLimitState, retryAfter?: number): RateLimitState => {
	const now = new Date();
	const failures = state.consecutive_failures + 1;
	const shouldOpenCircuit = failures >= CIRCUIT_BREAKER_THRESHOLD;

	const circuitOpenUntil = shouldOpenCircuit ? new Date(now.getTime() + CIRCUIT_OPEN_DURATION_MS) : state.circuit_open_until;
	const resetAt = retryAfter ? new Date(now.getTime() + retryAfter * 1000) : state.reset_at;

	return {
		...state,
		remaining: retryAfter ? 0 : state.remaining,
		reset_at: resetAt,
		consecutive_failures: failures,
		last_failure_at: now,
		circuit_open_until: circuitOpenUntil,
	};
};
