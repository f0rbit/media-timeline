import { connections } from "@/utils/api";
import { For, Show, createResource, createSignal } from "solid-js";
import { Collapsible, Checkbox } from "@f0rbit/ui";
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
	const { updateSetting } = useSettings(props.accountId, props.onUpdate);
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

	const triggerContent = (
		<>
			<span class="settings-title tertiary text-sm font-medium">Reddit Settings</span>
			<Show when={subreddits()?.length} keyed>
				{count => (
					<span class="muted text-xs">
						({visibleCount()}/{count} subreddits visible)
					</span>
				)}
			</Show>
		</>
	);

	return (
		<Collapsible trigger={triggerContent}>
			<div class="settings-content">
				<div class="filter-toggles">
					<Checkbox checked={hideComments()} onChange={toggleHideComments} label="Hide comments (show posts only)" />
					<Checkbox checked={hideNsfw()} onChange={toggleHideNsfw} label="Hide NSFW content" />
				</div>

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
												<div class={`repo-item ${isHidden() ? "repo-hidden" : ""}`}>
													<Checkbox checked={!isHidden()} onChange={() => toggleSubreddit(subreddit)} disabled={isUpdating()} label={`r/${subreddit}`} />
													<Show when={isHidden()}>
														<span class="muted text-xs">(hidden)</span>
													</Show>
												</div>
											);
										}}
									</For>
								</div>
							</Show>
						)}
					</Show>
				</div>
			</div>
		</Collapsible>
	);
}
