import { create_cloudflare_backend, create_corpus, define_store, json_codec, type Store } from "@f0rbit/corpus/cloudflare";
import { err, ok, type Result } from "@media-timeline/core";
import { z } from "zod";
import type { Bindings } from "./bindings";

export type CorpusError = { kind: "store_not_found"; store_id: string };

export type RawStoreId = `raw/${string}/${string}`;
export type TimelineStoreId = `timeline/${string}`;
export type StoreId = RawStoreId | TimelineStoreId;

export const rawStoreId = (platform: string, accountId: string): RawStoreId => `raw/${platform}/${accountId}`;

export const timelineStoreId = (userId: string): TimelineStoreId => `timeline/${userId}`;

const RawDataSchema = z.record(z.unknown());
const TimelineDataSchema = z.record(z.unknown());

type CorpusBackend = {
	d1: { prepare: (sql: string) => unknown };
	r2: {
		get: (key: string) => Promise<{ body: ReadableStream<Uint8Array>; arrayBuffer: () => Promise<ArrayBuffer> } | null>;
		put: (key: string, data: ReadableStream<Uint8Array> | Uint8Array) => Promise<void>;
		delete: (key: string) => Promise<void>;
		head: (key: string) => Promise<{ key: string } | null>;
	};
};

const toCorpusBackend = (env: Bindings): CorpusBackend => ({
	d1: env.DB as unknown as CorpusBackend["d1"],
	r2: env.BUCKET as unknown as CorpusBackend["r2"],
});

export type RawStore = { store: Store<Record<string, unknown>>; id: RawStoreId };
export type TimelineStore = { store: Store<Record<string, unknown>>; id: TimelineStoreId };

export function createRawStore(platform: string, accountId: string, env: Bindings): Result<RawStore, CorpusError> {
	const id = rawStoreId(platform, accountId);
	const corpus = create_corpus()
		.with_backend(create_cloudflare_backend(toCorpusBackend(env)))
		.with_store(define_store(id, json_codec(RawDataSchema)))
		.build();
	const store = corpus.stores[id];
	if (!store) return err({ kind: "store_not_found", store_id: id });
	return ok({ store, id });
}

export function createTimelineStore(userId: string, env: Bindings): Result<TimelineStore, CorpusError> {
	const id = timelineStoreId(userId);
	const corpus = create_corpus()
		.with_backend(create_cloudflare_backend(toCorpusBackend(env)))
		.with_store(define_store(id, json_codec(TimelineDataSchema)))
		.build();
	const store = corpus.stores[id];
	if (!store) return err({ kind: "store_not_found", store_id: id });
	return ok({ store, id });
}
