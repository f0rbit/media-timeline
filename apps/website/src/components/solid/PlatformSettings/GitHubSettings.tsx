import { type GitHubRepo, connections } from "@/utils/api";
import { For, Show, createResource, createSignal } from "solid-js";
import { Collapsible, Checkbox } from "@f0rbit/ui";
import { useSettings } from "./useSettings";

type GitHubSettingsData = { hidden_repos?: string[] };

type Props = {
	accountId: string;
	settings: GitHubSettingsData | null;
	onUpdate: () => void;
};

export default function GitHubSettings(props: Props) {
	const { updateSetting } = useSettings(props.accountId, props.onUpdate);
	const [repoUpdating, setRepoUpdating] = createSignal<string | null>(null);

	const [repos] = createResource(async () => {
		const result = await connections.getRepos(props.accountId);
		if (!result.ok) return [];
		return result.value.repos;
	});

	const hiddenRepos = () => new Set(props.settings?.hidden_repos ?? []);

	const toggleRepo = async (repoFullName: string) => {
		setRepoUpdating(repoFullName);
		const hidden = new Set(hiddenRepos());

		if (hidden.has(repoFullName)) {
			hidden.delete(repoFullName);
		} else {
			hidden.add(repoFullName);
		}

		await updateSetting<GitHubSettingsData>("hidden_repos", Array.from(hidden), props.settings);
		setRepoUpdating(null);
	};

	const visibleCount = () => {
		const allRepos = repos() ?? [];
		const hidden = hiddenRepos();
		return allRepos.filter(r => !hidden.has(r.full_name)).length;
	};

	return (
		<Collapsible
			trigger={
				<>
					<span class="settings-title">Repository Visibility</span>
					<Show when={repos()?.length}>
						<span class="muted text-xs">
							({visibleCount()}/{repos()?.length} visible)
						</span>
					</Show>
				</>
			}
		>
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
										const isUpdating = () => repoUpdating() === repo.full_name;
										return (
											<div class="repo-item">
												<Checkbox checked={!isHidden()} onChange={() => toggleRepo(repo.full_name)} label={repo.full_name} disabled={isUpdating()} class={`mono text-sm ${isHidden() ? "opacity-50" : ""}`} />
												<Show when={repo.is_private}>
													<span class="repo-private muted text-xs">(private)</span>
												</Show>
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
		</Collapsible>
	);
}
