import type { Backend } from "@f0rbit/corpus";
import { createLogger } from "../logger";
import { mergeByKey } from "../merge";
import type { ProviderError } from "../platforms/types";
import { type Result, err, ok, pipe, to_nullable } from "../utils";

const log = createLogger("cron:processor");

export type ProcessResult<TStats> = {
	account_id: string;
	meta_version: string;
	stats: TStats;
};

export type StoreStats = { version: string; newCount: number; total: number };
export const defaultStats: StoreStats = { version: "", newCount: 0, total: 0 };

export type MergeResult<T> = { merged: T; newCount: number };

type CreateStore<TData> = (backend: Backend, accountId: string) => Result<{ store: { put: (data: TData) => Promise<Result<{ version: string }, unknown>>; get_latest: () => Promise<Result<{ data: TData }, unknown>> }; id: string }, unknown>;

export type StoreConfig<TIncoming, TStored> = {
	name: string;
	create: CreateStore<TStored>;
	merge: (existing: TStored | null, incoming: TIncoming) => MergeResult<TStored>;
	getKey: (data: TIncoming) => string;
	getTotal: (merged: TStored) => number;
};

export type ProcessError = { kind: "fetch_failed"; message: string };

export type PlatformProvider<TFetch> = {
	fetch(token: string): Promise<Result<TFetch, ProviderError>>;
};

type StoreProcessor<TData> = {
	store: { put: (data: TData) => Promise<Result<{ version: string }, unknown>>; get_latest: () => Promise<Result<{ data: TData }, unknown>> };
	id: string;
};

const loadExisting = async <T>(store: StoreProcessor<T>["store"]): Promise<T | null> => to_nullable(await store.get_latest())?.data ?? null;

const processStore = async <TIncoming, TStored>(backend: Backend, accountId: string, config: StoreConfig<TIncoming, TStored>, incoming: TIncoming): Promise<StoreStats> => {
	const storeResult = config.create(backend, accountId);
	if (!storeResult.ok) return defaultStats;

	const store = storeResult.value.store;
	const existing = await loadExisting(store);
	const { merged, newCount } = config.merge(existing, incoming);
	const putResult = await store.put(merged);

	return pipe(putResult)
		.map(({ version }) => ({ version, newCount, total: config.getTotal(merged) }))
		.tap(({ newCount: n, total }) => log.debug(`Stored ${config.name}`, { new: n, total }))
		.unwrap_or(defaultStats);
};

export const storeWithMerge = async <TIncoming, TStored>(backend: Backend, accountId: string, config: StoreConfig<TIncoming, TStored>, incoming: TIncoming): Promise<StoreStats> => processStore(backend, accountId, config, incoming);

export const storeMeta = async <TMeta>(backend: Backend, accountId: string, create: CreateStore<TMeta>, meta: TMeta): Promise<string> => {
	const storeResult = create(backend, accountId);
	if (!storeResult.ok) return "";
	const putResult = await storeResult.value.store.put(meta);
	return putResult.ok ? putResult.value.version : "";
};

export const createMerger =
	<T, TKey extends string>(getKey: (item: T) => TKey) =>
	<TStore extends { [K in string]: T[] }>(field: keyof TStore) =>
	(existing: TStore | null, incoming: TStore): MergeResult<T[]> =>
		mergeByKey(existing?.[field] as T[] | null, incoming[field] as T[], getKey);

export const formatFetchError = (platform: string, error: ProviderError): ProcessError => ({
	kind: "fetch_failed",
	message: `${platform} fetch failed: ${error.kind}`,
});
