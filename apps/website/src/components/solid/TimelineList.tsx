import { createResource, createSignal, For, Show, Match, Switch } from "solid-js";
import { GitCommit, GitPullRequest, ChevronDown, ChevronRight } from "lucide-solid";
import { timeline, initMockAuth, getMockUserId, type ApiResult, type TimelineResponse, type TimelineGroup, type TimelineItem, type CommitGroup, type PullRequestPayload, type PRCommit } from "@/utils/api-client";
import { formatDate, formatRelativeTime } from "@/utils/formatters";

type ViewMode = "rendered" | "raw";

export default function TimelineList() {
	initMockAuth();

	const [viewMode, setViewMode] = createSignal<ViewMode>("rendered");

	const [data] = createResource(async () => {
		const userId = getMockUserId();
		const result: ApiResult<TimelineResponse> = await timeline.get(userId);
		if (result.ok === false) throw new Error(result.error.message);
		return result.data;
	});

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
				<Show when={viewMode() === "rendered"} fallback={<RawDataViewer data={data()!} />}>
					<TimelineGroups groups={data()!.data.groups} />
				</Show>
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
	const firstCommit = () => props.group.commits[0];
	const shouldCollapse = () => props.group.commits.length > 8;

	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<GitCommit size={16} />
			</div>
			<div class="timeline-content">
				<div class="timeline-main-row">
					<span class="timeline-repo">{props.group.repo}</span>
					<span class="timeline-time">{formatRelativeTime(firstCommit()?.timestamp ?? props.group.date)}</span>
				</div>
				<Show
					when={shouldCollapse()}
					fallback={
						<div class="timeline-nested-list">
							<For each={props.group.commits}>{commit => <NestedCommitRow commit={commit} />}</For>
						</div>
					}
				>
					<button class="timeline-expand-btn" onClick={() => setExpanded(!expanded())}>
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
		<div class="timeline-nested-row">
			<code class="timeline-sha">{payload().sha?.slice(0, 7)}</code>
			<Show when={props.commit.url} fallback={<span class="timeline-commit-msg">{props.commit.title}</span>}>
				<a href={props.commit.url} target="_blank" rel="noopener noreferrer" class="timeline-commit-msg">
					{props.commit.title}
				</a>
			</Show>
		</div>
	);
}

function PullRequestRow(props: { item: TimelineItem }) {
	const [expanded, setExpanded] = createSignal(false);
	const payload = () => props.item.payload as PullRequestPayload;
	const commits = () => payload().commits ?? [];
	const hasCommits = () => commits().length > 0;

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
			<div class="timeline-content">
				<div class="timeline-main-row">
					<div class="timeline-pr-header">
						<span class={`timeline-state ${stateClass()}`}>{payload().state}</span>
						<Show when={props.item.url} fallback={<span class="timeline-pr-title">{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="timeline-pr-title">
								{props.item.title}
							</a>
						</Show>
					</div>
					<span class="timeline-time">{formatRelativeTime(props.item.timestamp)}</span>
				</div>
				<div class="timeline-pr-meta">
					<span>#{payload().number}</span>
					<span style={{ color: "var(--text-muted)" }}> · </span>
					<span class="timeline-pr-branches">
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
						<button class="timeline-expand-btn" onClick={() => setExpanded(!expanded())}>
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
		<div class="timeline-nested-row">
			<code class="timeline-sha">{props.commit.sha.slice(0, 7)}</code>
			<Show when={props.commit.url} fallback={<span class="timeline-commit-msg">{truncatedMessage()}</span>}>
				<a href={props.commit.url} target="_blank" rel="noopener noreferrer" class="timeline-commit-msg">
					{truncatedMessage()}
				</a>
			</Show>
		</div>
	);
}

function CommitRow(props: { item: TimelineItem }) {
	const payload = () => props.item.payload as { sha?: string; repo?: string };

	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<GitCommit size={16} />
			</div>
			<div class="timeline-content">
				<div class="timeline-main-row">
					<div class="timeline-commit-header">
						<code class="timeline-sha">{payload().sha?.slice(0, 7)}</code>
						<Show when={props.item.url} fallback={<span class="timeline-commit-msg">{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="timeline-commit-msg">
								{props.item.title}
							</a>
						</Show>
					</div>
					<span class="timeline-time">{formatRelativeTime(props.item.timestamp)}</span>
				</div>
				<Show when={payload().repo}>
					<span class="timeline-repo-small">{payload().repo}</span>
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
			<div class="timeline-content">
				<div class="timeline-main-row">
					<div class="timeline-generic-header">
						<span class="timeline-type-badge">{props.item.type}</span>
						<Show when={props.item.url} fallback={<span>{props.item.title}</span>}>
							<a href={props.item.url} target="_blank" rel="noopener noreferrer">
								{props.item.title}
							</a>
						</Show>
					</div>
					<span class="timeline-time">{formatRelativeTime(props.item.timestamp)}</span>
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
