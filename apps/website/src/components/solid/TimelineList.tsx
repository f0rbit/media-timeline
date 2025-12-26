import { createResource, createSignal, createContext, useContext, For, Show, Match, Switch, type ParentComponent } from "solid-js";
import { GitCommit, GitPullRequest, ChevronDown, ChevronRight } from "lucide-solid";
import { timeline, initMockAuth, getMockUserId, type ApiResult, type TimelineResponse, type TimelineGroup, type TimelineItem, type CommitGroup, type PullRequestPayload, type PRCommit } from "@/utils/api-client";
import { formatDate, formatRelativeTime } from "@/utils/formatters";

type ViewMode = "rendered" | "raw";

const GithubUsernamesContext = createContext<string[]>([]);

const stripOwnerPrefix = (repo: string, usernames: string[]): string => {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return repo;
	if (usernames.some(u => u.toLowerCase() === owner.toLowerCase())) return name;
	return repo;
};

export default function TimelineList() {
	initMockAuth();

	const [viewMode, setViewMode] = createSignal<ViewMode>("rendered");

	const [data] = createResource(async () => {
		const userId = getMockUserId();
		const result: ApiResult<TimelineResponse> = await timeline.get(userId);
		if (result.ok === false) throw new Error(result.error.message);
		return result.data;
	});

	const githubUsernames = () => data()?.meta.github_usernames ?? [];

	return (
		<div class="timeline">
			<div class="timeline-header">
				<h2>Timeline</h2>
				<ViewToggle mode={viewMode()} onChange={setViewMode} />
			</div>

			<Show when={data.loading}>
				<p class="description">Loading timeline...</p>
			</Show>

			<Show when={data.error}>
				<p class="error-icon">Failed to load timeline: {data.error.message}</p>
			</Show>

			<Show when={data()}>
				<GithubUsernamesContext.Provider value={githubUsernames()}>
					<Show when={viewMode() === "rendered"} fallback={<RawDataViewer data={data()!} />}>
						<TimelineGroups groups={data()!.data.groups} />
					</Show>
				</GithubUsernamesContext.Provider>
			</Show>
		</div>
	);
}

type ViewToggleProps = {
	mode: ViewMode;
	onChange: (mode: ViewMode) => void;
};

function ViewToggle(props: ViewToggleProps) {
	return (
		<div class="view-toggle">
			<button class={props.mode === "rendered" ? "toggle-btn active" : "toggle-btn"} onClick={() => props.onChange("rendered")}>
				Rendered
			</button>
			<button class={props.mode === "raw" ? "toggle-btn active" : "toggle-btn"} onClick={() => props.onChange("raw")}>
				Raw JSON
			</button>
		</div>
	);
}

type TimelineGroupsProps = {
	groups: TimelineGroup[];
};

function TimelineGroups(props: TimelineGroupsProps) {
	// Flatten all items from all groups into a single sorted list
	const allItems = () => {
		const items: (TimelineItem | CommitGroup)[] = [];
		for (const group of props.groups) {
			items.push(...group.items);
		}
		// Sort by timestamp descending
		return items.sort((a, b) => {
			const timeA = a.type === "commit_group" ? (a.commits[0]?.timestamp ?? a.date) : a.timestamp;
			const timeB = b.type === "commit_group" ? (b.commits[0]?.timestamp ?? b.date) : b.timestamp;
			return new Date(timeB).getTime() - new Date(timeA).getTime();
		});
	};

	return (
		<Show when={allItems().length > 0} fallback={<EmptyTimeline />}>
			<div class="timeline-flat">
				<For each={allItems()}>{item => <TimelineEntry item={item} />}</For>
			</div>
		</Show>
	);
}

function EmptyTimeline() {
	return (
		<div class="empty-state">
			<p>No timeline data yet.</p>
			<a href="/connections">Connect a platform to get started</a>
		</div>
	);
}

type TimelineEntryProps = {
	item: TimelineItem | CommitGroup;
};

function TimelineEntry(props: TimelineEntryProps) {
	return (
		<Switch>
			<Match when={props.item.type === "commit_group"}>
				<CommitGroupRow group={props.item as CommitGroup} />
			</Match>
			<Match when={props.item.type === "pull_request"}>
				<PullRequestRow item={props.item as TimelineItem} />
			</Match>
			<Match when={props.item.type === "commit"}>
				<CommitRow item={props.item as TimelineItem} />
			</Match>
			<Match when={true}>
				<GenericRow item={props.item as TimelineItem} />
			</Match>
		</Switch>
	);
}

function CommitGroupRow(props: { group: CommitGroup }) {
	const [expanded, setExpanded] = createSignal(false);
	const githubUsernames = useContext(GithubUsernamesContext);
	const firstCommit = () => props.group.commits[0];
	const shouldCollapse = () => props.group.commits.length > 8;
	const displayRepo = () => stripOwnerPrefix(props.group.repo, githubUsernames);

	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<GitCommit size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<span class="text-xs muted nowrap shrink-0">{formatRelativeTime(firstCommit()?.timestamp ?? props.group.date)}</span>
				<div class="flex-row justify-between items-start" style={{ gap: "1rem" }}>
					<span class="inline-flex items-baseline">
						<span class="secondary font-medium">{displayRepo()}</span>
						<Show when={props.group.branch}>
							<span class="muted font-medium">{`:${props.group.branch}`}</span>
						</Show>
					</span>
				</div>
				<Show
					when={shouldCollapse()}
					fallback={
						<div class="timeline-nested-list">
							<For each={props.group.commits}>{commit => <NestedCommitRow commit={commit} />}</For>
						</div>
					}
				>
					<button class="button-reset inline-flex text-xs muted" style={{ gap: "0.25rem", padding: "0.125rem 0" }} onClick={() => setExpanded(!expanded())}>
						<Show when={expanded()} fallback={<ChevronRight size={14} />}>
							<ChevronDown size={14} />
						</Show>
						<span>{props.group.commits.length} commits</span>
					</button>
					<Show when={expanded()}>
						<div class="timeline-nested-list">
							<For each={props.group.commits}>{commit => <NestedCommitRow commit={commit} />}</For>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}

function NestedCommitRow(props: { commit: TimelineItem }) {
	const payload = () => props.commit.payload as { sha?: string };

	return (
		<div class="flex-row items-baseline" style={{ gap: "0.5rem", padding: "0.125rem 0.5rem", "font-size": "0.8125rem" }}>
			<code class="text-xs muted mono shrink-0">{payload().sha?.slice(0, 7)}</code>
			<Show when={props.commit.url} fallback={<span class="secondary truncate">{props.commit.title}</span>}>
				<a href={props.commit.url} target="_blank" rel="noopener noreferrer" class="secondary truncate">
					{props.commit.title}
				</a>
			</Show>
		</div>
	);
}

function PullRequestRow(props: { item: TimelineItem }) {
	const [expanded, setExpanded] = createSignal(false);
	const githubUsernames = useContext(GithubUsernamesContext);
	const payload = () => props.item.payload as PullRequestPayload;
	const commits = () => payload().commits ?? [];
	const hasCommits = () => commits().length > 0;
	const displayRepo = () => stripOwnerPrefix(payload().repo, githubUsernames);

	const stateClass = () => {
		switch (payload().state) {
			case "merged":
				return "timeline-state-merged";
			case "open":
				return "timeline-state-open";
			case "closed":
				return "timeline-state-closed";
			default:
				return "";
		}
	};

	return (
		<div class="timeline-row">
			<div class="timeline-icon timeline-icon-pr">
				<GitPullRequest size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<div class="flex-row items-center text-xs" style={{ gap: "0.375rem" }}>
					<span class="muted nowrap shrink-0">{formatRelativeTime(props.item.timestamp)}</span>
					<span class="muted">·</span>
					<span class={`timeline-state ${stateClass()}`}>{payload().state}</span>
				</div>
				<div class="flex-row justify-between items-start" style={{ gap: "1rem" }}>
					<div class="flex-row items-center flex-wrap min-w-0" style={{ gap: "0.5rem" }}>
						<Show when={props.item.url} fallback={<span class="secondary font-medium">{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="secondary font-medium">
								{props.item.title}
							</a>
						</Show>
					</div>
				</div>
				<div class="flex-row items-baseline text-xs muted" style={{ gap: "0.5rem" }}>
					<span>{displayRepo()}</span>
					<span>·</span>
					<span>#{payload().number}</span>
					<span>·</span>
					<span class="mono">
						{payload().head_ref} → {payload().base_ref}
					</span>
				</div>
				<Show when={hasCommits()}>
					<Show
						when={commits().length > 8}
						fallback={
							<div class="timeline-nested-list">
								<For each={commits()}>{commit => <PRCommitRow commit={commit} />}</For>
							</div>
						}
					>
						<button class="button-reset inline-flex text-xs muted" style={{ gap: "0.25rem", padding: "0.125rem 0" }} onClick={() => setExpanded(!expanded())}>
							<Show when={expanded()} fallback={<ChevronRight size={14} />}>
								<ChevronDown size={14} />
							</Show>
							<span>{commits().length} commits</span>
						</button>
						<Show when={expanded()}>
							<div class="timeline-nested-list">
								<For each={commits()}>{commit => <PRCommitRow commit={commit} />}</For>
							</div>
						</Show>
					</Show>
				</Show>
			</div>
		</div>
	);
}

function PRCommitRow(props: { commit: PRCommit }) {
	const truncatedMessage = () => {
		const firstLine = props.commit.message.split("\n")[0] ?? "";
		return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
	};

	return (
		<div class="flex-row items-baseline" style={{ gap: "0.5rem", padding: "0.125rem 0.5rem", "font-size": "0.8125rem" }}>
			<code class="text-xs muted mono shrink-0">{props.commit.sha.slice(0, 7)}</code>
			<Show when={props.commit.url} fallback={<span class="secondary truncate">{truncatedMessage()}</span>}>
				<a href={props.commit.url} target="_blank" rel="noopener noreferrer" class="secondary truncate">
					{truncatedMessage()}
				</a>
			</Show>
		</div>
	);
}

function CommitRow(props: { item: TimelineItem }) {
	const githubUsernames = useContext(GithubUsernamesContext);
	const payload = () => props.item.payload as { sha?: string; repo?: string };
	const displayRepo = () => {
		const repo = payload().repo;
		return repo ? stripOwnerPrefix(repo, githubUsernames) : undefined;
	};

	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<GitCommit size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<div class="flex justify-between items-start" style={{ gap: "1rem" }}>
					<div class="flex items-center" style={{ gap: "0.5rem", "min-width": 0 }}>
						<code class="text-xs muted mono shrink-0">{payload().sha?.slice(0, 7)}</code>
						<Show when={props.item.url} fallback={<span class="secondary truncate">{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="secondary truncate">
								{props.item.title}
							</a>
						</Show>
					</div>
					<span class="text-xs muted nowrap shrink-0">{formatRelativeTime(props.item.timestamp)}</span>
				</div>
				<Show when={displayRepo()}>
					<span class="text-xs muted">{displayRepo()}</span>
				</Show>
			</div>
		</div>
	);
}

function GenericRow(props: { item: TimelineItem }) {
	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<div class="timeline-dot" />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<div class="flex-row justify-between items-start" style={{ gap: "1rem" }}>
					<div class="flex-row items-center" style={{ gap: "0.5rem" }}>
						<span class="timeline-type-badge">{props.item.type}</span>
						<Show when={props.item.url} fallback={<span>{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer">
								{props.item.title}
							</a>
						</Show>
					</div>
					<span class="text-xs muted nowrap shrink-0">{formatRelativeTime(props.item.timestamp)}</span>
				</div>
			</div>
		</div>
	);
}

type RawDataViewerProps = {
	data: TimelineResponse;
};

function RawDataViewer(props: RawDataViewerProps) {
	return (
		<div class="raw-data-viewer">
			<pre class="code-block">{JSON.stringify(props.data, null, 2)}</pre>
		</div>
	);
}
