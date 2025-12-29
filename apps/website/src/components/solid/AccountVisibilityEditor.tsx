import { api } from "@/utils/api-client";
import { formatPlatformName } from "@/utils/formatters";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import PlatformIcon from "./PlatformIcon";

type VisibilityItem = {
	account_id: string;
	platform: string;
	platform_username: string | null;
	is_visible: boolean;
};

type VisibilityResponse = {
	visibility: VisibilityItem[];
};

type AccountVisibilityEditorProps = {
	profileId: string;
	onClose: () => void;
};

const fetchVisibility = async (profileId: string): Promise<VisibilityItem[]> => {
	const result = await api.get<VisibilityResponse>(`/profiles/${profileId}/visibility`);
	if (!result.ok) throw new Error(result.error.message);
	return result.data.visibility;
};

const saveVisibility = async (profileId: string, updates: Array<{ account_id: string; is_visible: boolean }>) => {
	const result = await api.put<{ updated: boolean; count: number }>(`/profiles/${profileId}/visibility`, { visibility: updates });
	if (!result.ok) throw new Error(result.error.message);
	return result.data;
};

type GroupedAccounts = Record<string, VisibilityItem[]>;

const groupByPlatform = (items: VisibilityItem[]): GroupedAccounts => {
	const result: GroupedAccounts = {};
	for (const item of items) {
		const existing = result[item.platform];
		result[item.platform] = existing ? [...existing, item] : [item];
	}
	return result;
};

const platformOrder = ["github", "twitter", "reddit", "bluesky", "youtube", "devpad"];

const sortPlatforms = (platforms: string[]): string[] =>
	[...platforms].sort((a, b) => {
		const aIdx = platformOrder.indexOf(a);
		const bIdx = platformOrder.indexOf(b);
		if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
		if (aIdx === -1) return 1;
		if (bIdx === -1) return -1;
		return aIdx - bIdx;
	});

export default function AccountVisibilityEditor(props: AccountVisibilityEditorProps) {
	const [visibility] = createResource(() => props.profileId, fetchVisibility);
	const [changes, setChanges] = createSignal<Map<string, boolean>>(new Map());
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const hasChanges = createMemo(() => changes().size > 0);

	const getEffectiveVisibility = (item: VisibilityItem): boolean => {
		const change = changes().get(item.account_id);
		return change !== undefined ? change : item.is_visible;
	};

	const isChanged = (accountId: string): boolean => changes().has(accountId);

	const toggleVisibility = (accountId: string, currentValue: boolean) => {
		setChanges(prev => {
			const next = new Map(prev);
			const originalItem = visibility()?.find(v => v.account_id === accountId);
			const originalValue = originalItem?.is_visible ?? true;
			const newValue = !currentValue;

			if (newValue === originalValue) {
				next.delete(accountId);
			} else {
				next.set(accountId, newValue);
			}
			return next;
		});
	};

	const handleSave = async () => {
		if (!hasChanges()) return;

		setSaving(true);
		setError(null);

		const updates = Array.from(changes().entries()).map(([account_id, is_visible]) => ({
			account_id,
			is_visible,
		}));

		try {
			await saveVisibility(props.profileId, updates);
			setChanges(new Map());
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to save changes");
		} finally {
			setSaving(false);
		}
	};

	const handleCancel = () => {
		setChanges(new Map());
		props.onClose();
	};

	const grouped = createMemo(() => {
		const items = visibility();
		if (!items) return {};
		return groupByPlatform(items);
	});

	const sortedPlatforms = createMemo(() => sortPlatforms(Object.keys(grouped())));

	return (
		<div class="visibility-editor">
			<div class="visibility-editor-header">
				<h5>Account Visibility</h5>
				<Show when={hasChanges()}>
					<span class="unsaved-indicator">Unsaved changes</span>
				</Show>
			</div>

			<Show when={visibility.loading}>
				<div class="visibility-loading">Loading accounts...</div>
			</Show>

			<Show when={visibility.error}>
				<div class="visibility-error">Failed to load accounts</div>
			</Show>

			<Show when={visibility()}>
				<div class="visibility-groups">
					<For each={sortedPlatforms()}>
						{platform => (
							<div class="visibility-group">
								<div class="visibility-group-header">
									<PlatformIcon platform={platform} size={14} />
									<span class="visibility-group-name">{formatPlatformName(platform)}</span>
								</div>
								<div class="visibility-group-items">
									<For each={grouped()[platform]}>
										{item => {
											const effectiveValue = () => getEffectiveVisibility(item);
											const changed = () => isChanged(item.account_id);

											return (
												<label class={`visibility-item ${changed() ? "visibility-item-changed" : ""}`}>
													<input type="checkbox" checked={effectiveValue()} onChange={() => toggleVisibility(item.account_id, effectiveValue())} />
													<span class="visibility-item-label">{item.platform_username ?? "Connected account"}</span>
													<Show when={changed()}>
														<span class="visibility-change-badge">{effectiveValue() ? "will show" : "will hide"}</span>
													</Show>
												</label>
											);
										}}
									</For>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>

			<Show when={error()}>
				<div class="visibility-error">{error()}</div>
			</Show>

			<div class="visibility-actions">
				<button type="button" class="button-reset tertiary text-sm" onClick={handleCancel}>
					Cancel
				</button>
				<button type="submit" onClick={handleSave} disabled={saving() || !hasChanges()}>
					{saving() ? "Saving..." : "Save"}
				</button>
			</div>

			<style>{`
				.visibility-editor {
					display: flex;
					flex-direction: column;
					gap: 16px;
				}

				.visibility-editor-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 12px;
				}

				.unsaved-indicator {
					font-size: 0.75rem;
					color: var(--text-link);
					padding: 2px 8px;
					background: oklch(from var(--text-link) l c h / 0.1);
					border-radius: 4px;
				}

				.visibility-loading,
				.visibility-error {
					padding: 12px;
					text-align: center;
					color: var(--text-muted);
					font-size: 0.875rem;
				}

				.visibility-error {
					color: oklch(from var(--item-red) 0.6 0.15 h);
				}

				.visibility-groups {
					display: flex;
					flex-direction: column;
					gap: 16px;
					max-height: 400px;
					overflow-y: auto;
				}

				.visibility-group {
					display: flex;
					flex-direction: column;
					gap: 8px;
				}

				.visibility-group-header {
					display: flex;
					align-items: center;
					gap: 8px;
					padding-bottom: 4px;
					border-bottom: 1px solid var(--input-border);
				}

				.visibility-group-name {
					font-size: 0.75rem;
					font-weight: 500;
					color: var(--text-tertiary);
					text-transform: uppercase;
					letter-spacing: 0.05em;
				}

				.visibility-group-items {
					display: flex;
					flex-direction: column;
					gap: 4px;
					padding-left: 22px;
				}

				.visibility-item {
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 6px 8px;
					border-radius: 4px;
					cursor: pointer;
					transition: background 0.15s;
				}

				.visibility-item:hover {
					background: var(--input-background);
				}

				.visibility-item-changed {
					background: oklch(from var(--text-link) l c h / 0.08);
				}

				.visibility-item-changed:hover {
					background: oklch(from var(--text-link) l c h / 0.12);
				}

				.visibility-item input[type="checkbox"] {
					width: 16px;
					height: 16px;
					cursor: pointer;
					accent-color: var(--text-link);
				}

				.visibility-item-label {
					flex: 1;
					font-size: 0.875rem;
					color: var(--text-secondary);
				}

				.visibility-change-badge {
					font-size: 0.625rem;
					padding: 2px 6px;
					border-radius: 3px;
					background: var(--text-link);
					color: var(--bg-primary);
					text-transform: uppercase;
					letter-spacing: 0.03em;
				}

				.visibility-actions {
					display: flex;
					justify-content: flex-end;
					gap: 12px;
					padding-top: 12px;
					border-top: 1px solid var(--input-border);
				}
			`}</style>
		</div>
	);
}
