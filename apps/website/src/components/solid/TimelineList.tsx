import { createResource, createSignal, For, Show } from "solid-js";
import { timeline, initMockAuth, getMockUserId, type ApiResult, type TimelineResponse, type TimelineGroup, type TimelineItem } from "@/utils/api-client";
import { formatDate, formatTime, formatPlatformName } from "@/utils/formatters";

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
								<For each={group.items}>{item => <TimelineItemCard item={item} />}</For>
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

type TimelineItemCardProps = {
	item: TimelineItem;
};

function TimelineItemCard(props: TimelineItemCardProps) {
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
