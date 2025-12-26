import { createResource, createSignal, For, Show, Match, Switch } from "solid-js";
import { timeline, initMockAuth, getMockUserId, type ApiResult, type TimelineResponse, type TimelineGroup, type TimelineItem, type CommitGroup } from "@/utils/api-client";
import { formatDate, formatTime, formatPlatformName, formatRelativeTime } from "@/utils/formatters";

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
		<div class="timeline-container">
			<div class="timeline-header flex-row" style={{ "justify-content": "space-between", "margin-bottom": "16px" }}>
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
		<div class="view-toggle flex-row" style={{ gap: "8px" }}>
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
	return (
		<Show when={props.groups.length > 0} fallback={<EmptyTimeline />}>
			<div class="timeline-groups flex-col" style={{ gap: "24px" }}>
				<For each={props.groups}>
					{group => (
						<div class="date-group">
							<h3 class="date-header">{formatDate(group.date)}</h3>
							<div class="items flex-col" style={{ gap: "12px" }}>
								<For each={group.items}>{item => <TimelineEntry item={item} />}</For>
							</div>
						</div>
					)}
				</For>
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
				<CommitGroupCard group={props.item as CommitGroup} />
			</Match>
			<Match when={props.item.type === "pull_request"}>
				<PullRequestCard item={props.item as TimelineItem} />
			</Match>
			<Match when={props.item.type === "commit"}>
				<CommitCard item={props.item as TimelineItem} />
			</Match>
			<Match when={true}>
				<GenericItemCard item={props.item as TimelineItem} />
			</Match>
		</Switch>
	);
}

function CommitGroupCard(props: { group: CommitGroup }) {
	const firstCommit = () => props.group.commits[0];
	const platform = () => firstCommit()?.platform ?? "github";

	return (
		<div class={`card timeline-item platform-${platform()}`}>
			<div class="flex-row" style={{ "justify-content": "space-between", "align-items": "flex-start" }}>
				<div class="flex-col" style={{ gap: "4px", flex: 1 }}>
					<div class="flex-row" style={{ gap: "8px", "align-items": "center" }}>
						<span class={`platform-badge platform-${platform()}`}>{formatPlatformName(platform())}</span>
						<span class="repo-name">{props.group.repo}</span>
					</div>
					<details>
						<summary style={{ cursor: "pointer" }}>
							<span class="commit-count">{props.group.commits.length} commits</span>
						</summary>
						<ul class="commit-list" style={{ "margin-top": "8px", "padding-left": "16px" }}>
							<For each={props.group.commits}>
								{commit => (
									<li style={{ "margin-bottom": "4px" }}>
										<div class="flex-row" style={{ gap: "8px" }}>
											<code style={{ "font-size": "smaller", color: "var(--text-muted)" }}>{(commit.payload as { sha?: string })?.sha?.slice(0, 7) ?? ""}</code>
											<Show when={commit.url} fallback={<span>{commit.title}</span>}>
												<a href={commit.url} target="_blank" rel="noopener noreferrer">
													{commit.title}
												</a>
											</Show>
										</div>
									</li>
								)}
							</For>
						</ul>
					</details>
				</div>
				<small class="description">{formatRelativeTime(firstCommit()?.timestamp ?? props.group.date)}</small>
			</div>
		</div>
	);
}

function PullRequestCard(props: { item: TimelineItem }) {
	const payload = () => props.item.payload as { state?: string; number?: number; head_ref?: string; base_ref?: string };

	const stateColor = () => {
		switch (payload().state) {
			case "merged":
				return "var(--pr-merged, #8957e5)";
			case "open":
				return "var(--pr-open, #3fb950)";
			case "closed":
				return "var(--pr-closed, #f85149)";
			default:
				return "var(--text-muted)";
		}
	};

	return (
		<div class={`card timeline-item platform-${props.item.platform}`}>
			<div class="flex-row" style={{ "justify-content": "space-between", "align-items": "flex-start" }}>
				<div class="flex-col" style={{ gap: "4px", flex: 1 }}>
					<div class="flex-row" style={{ gap: "8px", "align-items": "center" }}>
						<span class={`platform-badge platform-${props.item.platform}`}>{formatPlatformName(props.item.platform)}</span>
						<Show when={payload().state}>
							<span style={{ color: stateColor(), "font-weight": "500", "text-transform": "capitalize" }}>{payload().state}</span>
						</Show>
					</div>
					<h4 class="item-title">{props.item.title}</h4>
					<div class="flex-row" style={{ gap: "8px", "font-size": "smaller", color: "var(--text-muted)" }}>
						<Show when={payload().number}>
							<span>#{payload().number}</span>
						</Show>
						<Show when={payload().head_ref && payload().base_ref}>
							<span>
								{payload().head_ref} → {payload().base_ref}
							</span>
						</Show>
					</div>
				</div>
				<small class="description">{formatTime(props.item.timestamp)}</small>
			</div>
			<Show when={props.item.url}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="item-link">
					View on {formatPlatformName(props.item.platform)}
				</a>
			</Show>
		</div>
	);
}

function CommitCard(props: { item: TimelineItem }) {
	const payload = () => props.item.payload as { sha?: string; repo?: string };

	return (
		<div class={`card timeline-item platform-${props.item.platform}`}>
			<div class="flex-row" style={{ "justify-content": "space-between", "align-items": "flex-start" }}>
				<div class="flex-col" style={{ gap: "4px", flex: 1 }}>
					<div class="flex-row" style={{ gap: "8px", "align-items": "center" }}>
						<span class={`platform-badge platform-${props.item.platform}`}>{formatPlatformName(props.item.platform)}</span>
						<code style={{ "font-size": "smaller", color: "var(--text-muted)" }}>{payload().sha?.slice(0, 7)}</code>
					</div>
					<h4 class="item-title">{props.item.title}</h4>
					<Show when={payload().repo}>
						<span style={{ "font-size": "smaller", color: "var(--text-tertiary)" }}>{payload().repo}</span>
					</Show>
				</div>
				<small class="description">{formatTime(props.item.timestamp)}</small>
			</div>
			<Show when={props.item.url}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="item-link">
					View on {formatPlatformName(props.item.platform)}
				</a>
			</Show>
		</div>
	);
}

function GenericItemCard(props: { item: TimelineItem }) {
	return (
		<div class={`card timeline-item platform-${props.item.platform}`}>
			<div class="flex-row" style={{ "justify-content": "space-between", "align-items": "flex-start" }}>
				<div class="flex-col" style={{ gap: "4px", flex: 1 }}>
					<div class="flex-row" style={{ gap: "8px", "align-items": "center" }}>
						<span class={`platform-badge platform-${props.item.platform}`}>{formatPlatformName(props.item.platform)}</span>
						<span class="type-badge">{props.item.type}</span>
					</div>
					<h4 class="item-title">{props.item.title}</h4>
				</div>
				<small class="description">{formatTime(props.item.timestamp)}</small>
			</div>
			<Show when={props.item.url}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="item-link">
					View on {formatPlatformName(props.item.platform)}
				</a>
			</Show>
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
