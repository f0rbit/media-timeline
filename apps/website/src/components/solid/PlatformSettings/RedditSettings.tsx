import { connections } from "@/utils/api-client";
import { For, Show, createResource, createSignal } from "solid-js";

type Props = {
	accountId: string;
	settings: {
		hidden_subreddits?: string[];
		hide_comments?: boolean;
		hide_nsfw?: boolean;
	} | null;
	onUpdate: () => void;
};

export default function RedditSettings(props: Props) {
	const [updating, setUpdating] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	const [subreddits] = createResource(async () => {
		const result = await connections.getSubreddits(props.accountId);
		if (!result.ok) return [];
		return result.data.subreddits;
	});

	const hiddenSubreddits = () => new Set(props.settings?.hidden_subreddits ?? []);
	const hideComments = () => props.settings?.hide_comments ?? false;
	const hideNsfw = () => props.settings?.hide_nsfw ?? true;

	const updateSettings = async (updates: Record<string, unknown>) => {
		await connections.updateSettings(props.accountId, updates);
		props.onUpdate();
	};

	const toggleSubreddit = async (subreddit: string) => {
		setUpdating(subreddit);
		const hidden = new Set(hiddenSubreddits());

		if (hidden.has(subreddit)) {
			hidden.delete(subreddit);
		} else {
			hidden.add(subreddit);
		}

		await updateSettings({ hidden_subreddits: Array.from(hidden) });
		setUpdating(null);
	};

	const toggleHideComments = async () => {
		await updateSettings({ hide_comments: !hideComments() });
	};

	const toggleHideNsfw = async () => {
		await updateSettings({ hide_nsfw: !hideNsfw() });
	};

	const visibleCount = () => {
		const allSubreddits = subreddits() ?? [];
		const hidden = hiddenSubreddits();
		return allSubreddits.filter((s: string) => !hidden.has(s)).length;
	};

	const toggleExpanded = () => setExpanded(!expanded());

	return (
		<div class="settings-section">
			<button type="button" class="settings-header" onClick={toggleExpanded}>
				<ChevronIcon expanded={expanded()} />
				<h6 class="settings-title tertiary text-sm font-medium">Reddit Settings</h6>
				<Show when={subreddits() && subreddits()!.length > 0}>
					<span class="muted text-xs">
						({visibleCount()}/{subreddits()!.length} subreddits visible)
					</span>
				</Show>
			</button>

			<Show when={expanded()}>
				<div class="settings-content">
					{/* Global toggles */}
					<div class="filter-toggles">
						<label class="filter-toggle">
							<input type="checkbox" checked={hideComments()} onChange={toggleHideComments} />
							<span class="text-sm">Hide comments (show posts only)</span>
						</label>
						<label class="filter-toggle">
							<input type="checkbox" checked={hideNsfw()} onChange={toggleHideNsfw} />
							<span class="text-sm">Hide NSFW content</span>
						</label>
					</div>

					{/* Subreddit visibility */}
					<div class="subsection">
						<h6 class="tertiary text-xs font-medium" style={{ "margin-top": "8px", "margin-bottom": "4px" }}>
							Subreddit Visibility
						</h6>
						<Show when={subreddits.loading}>
							<p class="muted text-sm">Loading subreddits...</p>
						</Show>
						<Show when={subreddits.error}>
							<p class="error-icon text-sm">Failed to load subreddits</p>
						</Show>
						<Show when={subreddits() && subreddits()!.length > 0}>
							<div class="repo-list">
								<For each={subreddits()}>
									{subreddit => {
										const isHidden = () => hiddenSubreddits().has(subreddit);
										const isUpdating = () => updating() === subreddit;
										return (
											<label class={`repo-item ${isHidden() ? "repo-hidden" : ""}`}>
												<input type="checkbox" checked={!isHidden()} onChange={() => toggleSubreddit(subreddit)} disabled={isUpdating()} />
												<span class="repo-name mono text-sm">r/{subreddit}</span>
												<Show when={isHidden()}>
													<span class="muted text-xs">(hidden)</span>
												</Show>
											</label>
										);
									}}
								</For>
							</div>
						</Show>
						<Show when={subreddits() && subreddits()!.length === 0}>
							<p class="muted text-sm">No subreddits found yet. Refresh to fetch data.</p>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
}

function ChevronIcon(props: { expanded: boolean }) {
	return (
		<svg
			class={`chevron-icon ${props.expanded ? "expanded" : ""}`}
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}
