import { apiUrls } from "@/utils/api";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { Modal, ModalHeader, ModalTitle, ModalBody, Button, Empty, FormField, Input, Select, Spinner } from "@f0rbit/ui";
import PlatformIcon from "./PlatformIcon";

type Filter = {
	id: string;
	account_id: string;
	platform: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

type FiltersResponse = {
	filters: Filter[];
};

type Account = {
	id: string;
	platform: string;
	platform_username: string | null;
};

type FilterEditorProps = {
	profileId: string;
	accounts: Account[];
	isOpen: boolean;
	onClose: () => void;
};

const FILTER_KEYS_BY_PLATFORM: Record<string, string[]> = {
	github: ["repo", "keyword"],
	reddit: ["subreddit", "keyword"],
	twitter: ["twitter_account", "keyword"],
};

const FILTER_KEY_LABELS: Record<string, string> = {
	repo: "Repository",
	subreddit: "Subreddit",
	keyword: "Keyword",
	twitter_account: "Account",
};

const fetchFilters = async (profileId: string): Promise<Filter[]> => {
	const res = await fetch(apiUrls.profiles(`/${profileId}/filters`), {
		credentials: "include",
	});
	if (!res.ok) throw new Error("Failed to fetch filters");
	const data: FiltersResponse = await res.json();
	return data.filters;
};

const getPlatformForAccount = (accounts: Account[], accountId: string): string | undefined => accounts.find(a => a.id === accountId)?.platform;

const getFilterKeysForPlatform = (platform: string): string[] => FILTER_KEYS_BY_PLATFORM[platform] ?? ["keyword"];

const formatFilterDescription = (filter: Filter): string => {
	const keyLabel = FILTER_KEY_LABELS[filter.filter_key] ?? filter.filter_key;
	return `${keyLabel}: ${filter.filter_value}`;
};

const groupAccountsByPlatform = (accounts: Account[]): Map<string, Account[]> =>
	accounts.reduce((map, account) => {
		const existing = map.get(account.platform) ?? [];
		map.set(account.platform, [...existing, account]);
		return map;
	}, new Map<string, Account[]>());

export default function FilterEditor(props: FilterEditorProps) {
	const [filters, { refetch }] = createResource(() => fetchFilters(props.profileId));

	const [accountId, setAccountId] = createSignal(props.accounts[0]?.id ?? "");
	const [filterType, setFilterType] = createSignal<"include" | "exclude">("include");
	const [filterKey, setFilterKey] = createSignal("keyword");
	const [filterValue, setFilterValue] = createSignal("");
	const [adding, setAdding] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const selectedPlatform = createMemo(() => getPlatformForAccount(props.accounts, accountId()));
	const availableFilterKeys = createMemo(() => getFilterKeysForPlatform(selectedPlatform() ?? ""));
	const groupedAccounts = createMemo(() => groupAccountsByPlatform(props.accounts));

	const handleAccountChange = (newAccountId: string) => {
		setAccountId(newAccountId);
		const platform = getPlatformForAccount(props.accounts, newAccountId);
		const keys = getFilterKeysForPlatform(platform ?? "");
		if (!keys.includes(filterKey())) {
			setFilterKey(keys[0] ?? "keyword");
		}
	};

	const addFilter = async () => {
		if (!accountId() || !filterValue().trim()) {
			setError("Please fill in all fields");
			return;
		}

		setAdding(true);
		setError(null);

		try {
			const res = await fetch(apiUrls.profiles(`/${props.profileId}/filters`), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId(),
					filter_type: filterType(),
					filter_key: filterKey(),
					filter_value: filterValue().trim(),
				}),
				credentials: "include",
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string; message?: string };
				throw new Error(data.error ?? data.message ?? "Failed to add filter");
			}

			setFilterValue("");
			refetch();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add filter");
		} finally {
			setAdding(false);
		}
	};

	const removeFilter = async (filterId: string) => {
		try {
			const res = await fetch(apiUrls.profiles(`/${props.profileId}/filters/${filterId}`), {
				method: "DELETE",
				credentials: "include",
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string; message?: string };
				throw new Error(data.error ?? data.message ?? "Failed to remove filter");
			}

			refetch();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove filter");
		}
	};

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		addFilter();
	};

	return (
		<Modal open={props.isOpen} onClose={props.onClose}>
			<ModalHeader>
				<ModalTitle>Content Filters</ModalTitle>
			</ModalHeader>

			<ModalBody>
				<Show when={filters.loading}>
					<div class="loading-state">
						<Spinner size="sm" />
						<p class="tertiary text-sm">Loading filters...</p>
					</div>
				</Show>

				<Show when={filters.error}>
					<p class="error-icon text-sm">Failed to load filters</p>
				</Show>

				<Show when={!filters.loading && !filters.error}>
					<div class="filter-list">
						<Show when={(filters()?.length ?? 0) === 0}>
							<Empty title="No filters configured" description="Add filters to include or exclude specific content." />
						</Show>

						<For each={filters()}>{filter => <FilterItem filter={filter} accounts={props.accounts} onRemove={() => removeFilter(filter.id)} />}</For>
					</div>
				</Show>

				<form class="filter-add-form" onSubmit={handleSubmit}>
					<h6 class="secondary font-medium">Add Filter</h6>

					<FormField label="Account">
						<Select value={accountId()} onChange={e => handleAccountChange(e.currentTarget.value)}>
							<For each={[...groupedAccounts().entries()]}>
								{([platform, accounts]) => (
									<optgroup label={formatPlatformLabel(platform)}>
										<For each={accounts}>{account => <option value={account.id}>{account.platform_username ?? account.id.slice(0, 8)}</option>}</For>
									</optgroup>
								)}
							</For>
						</Select>
					</FormField>

					<FormField label="Filter Type">
						<div class="filter-type-toggle">
							<button type="button" class={`filter-type-btn ${filterType() === "include" ? "filter-type-include active" : ""}`} onClick={() => setFilterType("include")}>
								Include
							</button>
							<button type="button" class={`filter-type-btn ${filterType() === "exclude" ? "filter-type-exclude active" : ""}`} onClick={() => setFilterType("exclude")}>
								Exclude
							</button>
						</div>
					</FormField>

					<FormField label="Filter Key">
						<Select value={filterKey()} onChange={e => setFilterKey(e.currentTarget.value)}>
							<For each={availableFilterKeys()}>{key => <option value={key}>{FILTER_KEY_LABELS[key] ?? key}</option>}</For>
						</Select>
					</FormField>

					<FormField label="Value" error={error() ?? undefined}>
						<Input type="text" value={filterValue()} onInput={e => setFilterValue(e.currentTarget.value)} placeholder={getPlaceholder(filterKey())} error={!!error()} />
					</FormField>

					<div class="filter-form-actions">
						<Button type="submit" disabled={adding() || !filterValue().trim()} loading={adding()}>
							Add Filter
						</Button>
					</div>
				</form>
			</ModalBody>
		</Modal>
	);
}

type FilterItemProps = {
	filter: Filter;
	accounts: Account[];
	onRemove: () => void;
};

function FilterItem(props: FilterItemProps) {
	const account = () => props.accounts.find(a => a.id === props.filter.account_id);
	const isInclude = () => props.filter.filter_type === "include";

	return (
		<div class={`filter-item ${isInclude() ? "filter-item-include" : "filter-item-exclude"}`}>
			<div class="filter-item-icon">
				<PlatformIcon platform={props.filter.platform} size={14} />
			</div>
			<div class="filter-item-content">
				<span class={`filter-item-type ${isInclude() ? "filter-type-include" : "filter-type-exclude"}`}>{isInclude() ? "Include" : "Exclude"}</span>
				<span class="filter-item-description">{formatFilterDescription(props.filter)}</span>
				<Show when={account()?.platform_username}>
					<span class="filter-item-account muted text-xs">({account()?.platform_username})</span>
				</Show>
			</div>
			<Button icon variant="ghost" onClick={props.onRemove} label="Remove filter">
				<CloseIcon size={14} />
			</Button>
		</div>
	);
}

const formatPlatformLabel = (platform: string): string => platform.charAt(0).toUpperCase() + platform.slice(1);

const getPlaceholder = (filterKey: string): string => {
	switch (filterKey) {
		case "repo":
			return "owner/repository";
		case "subreddit":
			return "programming";
		case "twitter_account":
			return "@username";
		case "keyword":
			return "search term";
		default:
			return "value";
	}
};

function CloseIcon(props: { size?: number }) {
	const size = props.size ?? 18;
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}
