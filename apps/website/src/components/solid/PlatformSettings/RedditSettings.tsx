import { connections } from "@/utils/api-client";
import { For, Show, createResource, createSignal } from "solid-js";
import ChevronIcon from "../ChevronIcon";
import { useSettings } from "./useSettings";

type RedditSettingsData = {
	hidden_subreddits?: string[];
	hide_comments?: boolean;
	hide_nsfw?: boolean;
};

type Props = {
	accountId: string;
	settings: RedditSettingsData | null;
	onUpdate: () => void;
};

export default function RedditSettings(props: Props) {
	const { expanded, setExpanded, updateSetting } = useSettings(props.accountId, props.onUpdate);
	const [subredditUpdating, setSubredditUpdating] = createSignal<string | null>(null);

	const [subreddits] = createResource(async () => {
		const result = await connections.getSubreddits(props.accountId);
		if (!result.ok) return [];
		return result.value.subreddits;
	});

	const hiddenSubreddits = () => new Set(props.settings?.hidden_subreddits ?? []);
	const hideComments = () => props.settings?.hide_comments ?? false;
	const hideNsfw = () => props.settings?.hide_nsfw ?? true;

	const toggleSubreddit = async (subreddit: string) => {
		setSubredditUpdating(subreddit);
		const hidden = new Set(hiddenSubreddits());

		if (hidden.has(subreddit)) {
			hidden.delete(subreddit);
		} else {
			hidden.add(subreddit);
		}

		await updateSetting<RedditSettingsData>("hidden_subreddits", Array.from(hidden), props.settings);
		setSubredditUpdating(null);
	};

	const toggleHideComments = () => updateSetting<RedditSettingsData>("hide_comments", !hideComments(), props.settings);

	const toggleHideNsfw = () => updateSetting<RedditSettingsData>("hide_nsfw", !hideNsfw(), props.settings);

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
				<Show when={subreddits()?.length} keyed>
					{count => (
						<span class="muted text-xs">
							({visibleCount()}/{count} subreddits visible)
						</span>
					)}
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
						<Show when={subreddits()} keyed>
							{subredditList => (
								<Show when={subredditList.length > 0} fallback={<p class="muted text-sm">No subreddits found yet. Refresh to fetch data.</p>}>
									<div class="repo-list">
										<For each={subredditList}>
											{subreddit => {
												const isHidden = () => hiddenSubreddits().has(subreddit);
												const isUpdating = () => subredditUpdating() === subreddit;
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
							)}
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
}
