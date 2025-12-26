import { Match, Switch, Show, For } from "solid-js";
import PlatformIcon from "./PlatformIcon";
import { formatRelativeTime } from "../../utils/formatters";

type TimelineItemData = {
	id: string;
	platform: string;
	type: string;
	timestamp: string;
	title: string;
	url?: string;
	payload: Record<string, unknown>;
};

type Props = {
	item: TimelineItemData;
};

export default function TimelineItem(props: Props) {
	return (
		<div class={`timeline-item platform-${props.item.platform}`}>
			<div class="flex-row" style={{ gap: "8px" }}>
				<PlatformIcon platform={props.item.platform} size={16} />
				<span style={{ color: "var(--text-muted)", "font-size": "smaller" }}>{formatRelativeTime(props.item.timestamp)}</span>
			</div>
			<Switch fallback={<DefaultView item={props.item} />}>
				<Match when={props.item.type === "commit"}>
					<CommitView item={props.item} />
				</Match>
				<Match when={props.item.type === "commit_group"}>
					<CommitGroupView item={props.item} />
				</Match>
				<Match when={props.item.type === "post"}>
					<PostView item={props.item} />
				</Match>
				<Match when={props.item.type === "video"}>
					<VideoView item={props.item} />
				</Match>
				<Match when={props.item.type === "task"}>
					<TaskView item={props.item} />
				</Match>
			</Switch>
		</div>
	);
}

function CommitView(props: { item: TimelineItemData }) {
	const sha = () => (props.item.payload.sha as string)?.slice(0, 7) ?? "";
	const repo = () => props.item.payload.repo as string | undefined;

	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={props.item.url} fallback={<span>{props.item.title}</span>}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer">
					{props.item.title}
				</a>
			</Show>
			<div class="flex-row" style={{ gap: "8px" }}>
				<Show when={sha()}>
					<code style={{ "font-size": "smaller", color: "var(--text-muted)" }}>{sha()}</code>
				</Show>
				<Show when={repo()}>
					<span style={{ "font-size": "smaller", color: "var(--text-tertiary)" }}>{repo()}</span>
				</Show>
			</div>
		</div>
	);
}

function CommitGroupView(props: { item: TimelineItemData }) {
	const commits = () => (props.item.payload.commits as Array<{ sha: string; message: string; url?: string }>) ?? [];
	const repo = () => props.item.payload.repo as string | undefined;

	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={repo()}>
				<span style={{ color: "var(--text-secondary)" }}>{repo()}</span>
			</Show>
			<details>
				<summary class="flex-row" style={{ cursor: "pointer", gap: "4px" }}>
					<span style={{ color: "var(--text-link)" }}>{commits().length} commits</span>
					<span class="down-arrow">▼</span>
					<span class="up-arrow">▲</span>
				</summary>
				<ul style={{ "margin-top": "8px" }}>
					<For each={commits()}>
						{commit => (
							<li class="flex-row" style={{ gap: "8px", "margin-bottom": "4px" }}>
								<code style={{ "font-size": "smaller", color: "var(--text-muted)" }}>{commit.sha.slice(0, 7)}</code>
								<Show when={commit.url} fallback={<span>{commit.message}</span>}>
									<a href={commit.url} target="_blank" rel="noopener noreferrer">
										{commit.message}
									</a>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</details>
		</div>
	);
}

function PostView(props: { item: TimelineItemData }) {
	const likes = () => props.item.payload.likes as number | undefined;
	const reposts = () => props.item.payload.reposts as number | undefined;
	const replies = () => props.item.payload.replies as number | undefined;

	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={props.item.url} fallback={<p class="description">{props.item.title}</p>}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer">
					{props.item.title}
				</a>
			</Show>
			<div class="flex-row" style={{ gap: "12px", "font-size": "smaller", color: "var(--text-muted)" }}>
				<Show when={likes() !== undefined}>
					<span>{likes()} likes</span>
				</Show>
				<Show when={reposts() !== undefined}>
					<span>{reposts()} reposts</span>
				</Show>
				<Show when={replies() !== undefined}>
					<span>{replies()} replies</span>
				</Show>
			</div>
		</div>
	);
}

function VideoView(props: { item: TimelineItemData }) {
	const views = () => props.item.payload.views as number | undefined;
	const duration = () => props.item.payload.duration as string | undefined;
	const channel = () => props.item.payload.channel as string | undefined;

	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={props.item.url} fallback={<span>{props.item.title}</span>}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer">
					{props.item.title}
				</a>
			</Show>
			<div class="flex-row" style={{ gap: "12px", "font-size": "smaller", color: "var(--text-muted)" }}>
				<Show when={channel()}>
					<span>{channel()}</span>
				</Show>
				<Show when={views() !== undefined}>
					<span>{formatViews(views()!)} views</span>
				</Show>
				<Show when={duration()}>
					<span>{duration()}</span>
				</Show>
			</div>
		</div>
	);
}

function TaskView(props: { item: TimelineItemData }) {
	const status = () => props.item.payload.status as string | undefined;
	const priority = () => props.item.payload.priority as string | undefined;
	const project = () => props.item.payload.project as string | undefined;

	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={props.item.url} fallback={<span class="task-title">{props.item.title}</span>}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer" class="task-title">
					{props.item.title}
				</a>
			</Show>
			<div class="flex-row" style={{ gap: "12px", "font-size": "smaller" }}>
				<Show when={project()}>
					<span style={{ color: "var(--text-tertiary)" }}>{project()}</span>
				</Show>
				<Show when={status()}>
					<span style={{ color: "var(--text-muted)" }}>{status()}</span>
				</Show>
				<Show when={priority()}>
					<span class={`priority-${priority()}`}>{priority()}</span>
				</Show>
			</div>
		</div>
	);
}

function DefaultView(props: { item: TimelineItemData }) {
	return (
		<div class="flex-col" style={{ gap: "4px" }}>
			<Show when={props.item.url} fallback={<span>{props.item.title}</span>}>
				<a href={props.item.url} target="_blank" rel="noopener noreferrer">
					{props.item.title}
				</a>
			</Show>
		</div>
	);
}

function formatViews(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
	return count.toString();
}
