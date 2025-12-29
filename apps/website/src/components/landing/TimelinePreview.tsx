import ArrowBigUp from "lucide-solid/icons/arrow-big-up";
import GitCommit from "lucide-solid/icons/git-commit-horizontal";
import MessageSquareText from "lucide-solid/icons/message-square-text";
import { For, Match, Switch } from "solid-js";
import PlatformIcon from "../solid/PlatformIcon";

type MockCommit = {
	sha: string;
	message: string;
};

type MockTimelineItem = {
	type: "commit_group" | "reddit_post" | "tweet" | "bluesky_post";
	platform: "github" | "reddit" | "twitter" | "bluesky";
	timestamp: string;
	title?: string;
	repo?: string;
	branch?: string;
	commits?: MockCommit[];
	subreddit?: string;
	score?: number;
	comments?: number;
	content?: string;
};

const mockData: MockTimelineItem[] = [
	{
		type: "commit_group",
		platform: "github",
		timestamp: "2 hours ago",
		repo: "media-timeline",
		branch: "main",
		commits: [
			{ sha: "a1b2c3d", message: "feat: add timeline preview component" },
			{ sha: "e4f5g6h", message: "style: update landing page gradients" },
			{ sha: "i7j8k9l", message: "fix: resolve hydration mismatch" },
		],
	},
	{
		type: "reddit_post",
		platform: "reddit",
		timestamp: "5 hours ago",
		title: "Show r/programming: I built a tool to aggregate all my dev activity",
		subreddit: "programming",
		score: 247,
		comments: 42,
	},
	{
		type: "tweet",
		platform: "twitter",
		timestamp: "1 day ago",
		content: "Shipping a new feature today. Sometimes the best code is the code you delete.",
	},
	{
		type: "bluesky_post",
		platform: "bluesky",
		timestamp: "2 days ago",
		content: "Just discovered you can self-host your entire digital presence. The future is decentralized.",
	},
];

function CommitGroupRow(props: { item: MockTimelineItem }) {
	return (
		<div class="timeline-row">
			<div class="timeline-icon">
				<GitCommit size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<span class="text-xs muted nowrap shrink-0">{props.item.timestamp}</span>
				<div class="flex-row justify-between items-start" style={{ gap: "1rem" }}>
					<span class="inline-flex items-baseline">
						<span class="secondary font-medium">{props.item.repo}</span>
						<span class="muted font-medium">{`:${props.item.branch}`}</span>
					</span>
				</div>
				<div class="timeline-nested-list">
					<For each={props.item.commits}>
						{commit => (
							<div class="flex-row items-baseline" style={{ gap: "0.5rem", padding: "0.125rem 0.5rem", "font-size": "0.8125rem" }}>
								<code class="text-xs muted mono shrink-0">{commit.sha}</code>
								<span class="secondary truncate">{commit.message}</span>
							</div>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}

function RedditPostRow(props: { item: MockTimelineItem }) {
	return (
		<div class="timeline-row">
			<div class="timeline-icon timeline-icon-reddit">
				<MessageSquareText size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<span class="text-xs muted nowrap">{props.item.timestamp}</span>
				<div class="flex-row items-start" style={{ gap: "0.5rem" }}>
					<span class="secondary font-medium">{props.item.title}</span>
				</div>
				<div class="flex-row items-center text-xs muted" style={{ gap: "0.5rem" }}>
					<span>r/{props.item.subreddit}</span>
					<span>·</span>
					<span class="inline-flex items-center" style={{ gap: "0.25rem" }}>
						<ArrowBigUp size={12} />
						<span>{props.item.score}</span>
					</span>
					<span>·</span>
					<span>{props.item.comments} comments</span>
				</div>
			</div>
		</div>
	);
}

function TweetRow(props: { item: MockTimelineItem }) {
	return (
		<div class="timeline-row">
			<div class="timeline-icon" style={{ color: "var(--text-primary)" }}>
				<PlatformIcon platform="twitter" size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<span class="text-xs muted nowrap">{props.item.timestamp}</span>
				<span class="secondary">{props.item.content}</span>
			</div>
		</div>
	);
}

function BlueskyPostRow(props: { item: MockTimelineItem }) {
	return (
		<div class="timeline-row">
			<div class="timeline-icon" style={{ color: "oklch(55% 0.15 230)" }}>
				<PlatformIcon platform="bluesky" size={16} />
			</div>
			<div class="flex-col" style={{ gap: "0.25rem", flex: 1, "min-width": 0 }}>
				<span class="text-xs muted nowrap">{props.item.timestamp}</span>
				<span class="secondary">{props.item.content}</span>
			</div>
		</div>
	);
}

export default function TimelinePreview() {
	return (
		<div class="timeline-flat">
			<For each={mockData}>
				{item => (
					<Switch>
						<Match when={item.type === "commit_group"}>
							<CommitGroupRow item={item} />
						</Match>
						<Match when={item.type === "reddit_post"}>
							<RedditPostRow item={item} />
						</Match>
						<Match when={item.type === "tweet"}>
							<TweetRow item={item} />
						</Match>
						<Match when={item.type === "bluesky_post"}>
							<BlueskyPostRow item={item} />
						</Match>
					</Switch>
				)}
			</For>
		</div>
	);
}
