import { createResource, createSignal, For, Show } from "solid-js";
import { connections, type GitHubRepo } from "@/utils/api-client";

type Props = {
	accountId: string;
	settings: { hidden_repos?: string[] } | null;
	onUpdate: () => void;
};

export default function GitHubSettings(props: Props) {
	const [updating, setUpdating] = createSignal<string | null>(null);

	const [repos] = createResource(async () => {
		const result = await connections.getRepos(props.accountId);
		if (!result.ok) return [];
		return result.data.repos;
	});

	const hiddenRepos = () => new Set(props.settings?.hidden_repos ?? []);

	const toggleRepo = async (repoName: string) => {
		setUpdating(repoName);
		const hidden = new Set(hiddenRepos());

		if (hidden.has(repoName)) {
			hidden.delete(repoName);
		} else {
			hidden.add(repoName);
		}

		await connections.updateSettings(props.accountId, {
			hidden_repos: Array.from(hidden),
		});

		setUpdating(null);
		props.onUpdate();
	};

	const visibleCount = () => {
		const allRepos = repos() ?? [];
		const hidden = hiddenRepos();
		return allRepos.filter(r => !hidden.has(r.name)).length;
	};

	return (
		<div class="settings-section">
			<h6 class="settings-title tertiary text-sm font-medium">Repository Visibility</h6>
			<Show when={repos.loading}>
				<p class="muted text-sm">Loading repositories...</p>
			</Show>
			<Show when={repos.error}>
				<p class="error-icon text-sm">Failed to load repositories</p>
			</Show>
			<Show when={repos() && repos()!.length > 0}>
				<div class="repo-list">
					<For each={repos()}>
						{repo => {
							const isHidden = () => hiddenRepos().has(repo.name);
							const isUpdating = () => updating() === repo.name;
							return (
								<label class={`repo-item ${isHidden() ? "repo-hidden" : ""}`}>
									<input type="checkbox" checked={!isHidden()} onChange={() => toggleRepo(repo.name)} disabled={isUpdating()} />
									<span class="repo-name mono text-sm">{repo.name}</span>
									<Show when={isHidden()}>
										<span class="muted text-xs">(hidden)</span>
									</Show>
									<span class="repo-count muted text-xs nowrap">{repo.commit_count} commits</span>
								</label>
							);
						}}
					</For>
				</div>
				<p class="muted text-xs">
					Showing {visibleCount()} of {repos()!.length} repositories
				</p>
			</Show>
			<Show when={repos() && repos()!.length === 0}>
				<p class="muted text-sm">No repositories found yet. Refresh to fetch data.</p>
			</Show>
		</div>
	);
}
