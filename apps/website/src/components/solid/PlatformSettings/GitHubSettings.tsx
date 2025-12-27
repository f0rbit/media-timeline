import { type GitHubRepo, connections } from "@/utils/api-client";
import { For, Show, createResource, createSignal } from "solid-js";

type Props = {
	accountId: string;
	settings: { hidden_repos?: string[] } | null;
	onUpdate: () => void;
};

export default function GitHubSettings(props: Props) {
	const [updating, setUpdating] = createSignal<string | null>(null);
	const [expanded, setExpanded] = createSignal(false);

	const [repos] = createResource(async () => {
		const result = await connections.getRepos(props.accountId);
		if (!result.ok) return [];
		return result.data.repos;
	});

	const hiddenRepos = () => new Set(props.settings?.hidden_repos ?? []);

	const toggleRepo = async (repoFullName: string) => {
		setUpdating(repoFullName);
		const hidden = new Set(hiddenRepos());

		if (hidden.has(repoFullName)) {
			hidden.delete(repoFullName);
		} else {
			hidden.add(repoFullName);
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
		return allRepos.filter(r => !hidden.has(r.full_name)).length;
	};

	const toggleExpanded = () => setExpanded(!expanded());

	return (
		<div class="settings-section">
			<button type="button" class="settings-header" onClick={toggleExpanded}>
				<ChevronIcon expanded={expanded()} />
				<h6 class="settings-title tertiary text-sm font-medium">Repository Visibility</h6>
				<Show when={repos()?.length} keyed>
					{count => (
						<span class="muted text-xs">
							({visibleCount()}/{count} visible)
						</span>
					)}
				</Show>
			</button>

			<Show when={expanded()}>
				<div class="settings-content">
					<Show when={repos.loading}>
						<p class="muted text-sm">Loading repositories...</p>
					</Show>
					<Show when={repos.error}>
						<p class="error-icon text-sm">Failed to load repositories</p>
					</Show>
					<Show when={repos()} keyed>
						{repoList => (
							<Show when={repoList.length > 0} fallback={<p class="muted text-sm">No repositories found yet. Refresh to fetch data.</p>}>
								<div class="repo-list">
									<For each={repoList}>
										{repo => {
											const isHidden = () => hiddenRepos().has(repo.full_name);
											const isUpdating = () => updating() === repo.full_name;
											return (
												<label class={`repo-item ${isHidden() ? "repo-hidden" : ""}`}>
													<input type="checkbox" checked={!isHidden()} onChange={() => toggleRepo(repo.full_name)} disabled={isUpdating()} />
													<span class="repo-name mono text-sm">{repo.full_name}</span>
													<Show when={repo.is_private}>
														<span class="repo-private muted text-xs">(private)</span>
													</Show>
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
