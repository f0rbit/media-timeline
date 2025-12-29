import type { CommitGroup, TimelineItem } from "@/utils/api-client";
import { formatRelativeTime } from "@/utils/formatters";
import { For, Show } from "solid-js";
import PlatformIcon from "../PlatformIcon";

type RecentActivityProps = {
	items: (TimelineItem | CommitGroup)[];
};

const getTitle = (item: TimelineItem | CommitGroup): string => {
	if (item.type === "commit_group") {
		return `${item.commits.length} commits to ${item.repo}`;
	}
	return item.title;
};

const getTimestamp = (item: TimelineItem | CommitGroup): string => {
	if (item.type === "commit_group") {
		return item.commits[0]?.timestamp ?? item.date;
	}
	return item.timestamp;
};

const getPlatform = (item: TimelineItem | CommitGroup): string => {
	if (item.type === "commit_group") {
		return "github";
	}
	return item.platform;
};

export default function RecentActivity(props: RecentActivityProps) {
	return (
		<div class="recent-activity-list">
			<For each={props.items}>
				{item => (
					<div class="recent-activity-item">
						<div class="recent-activity-icon">
							<PlatformIcon platform={getPlatform(item)} size={16} />
						</div>
						<div class="recent-activity-content">
							<span class="recent-activity-title">{getTitle(item)}</span>
						</div>
						<span class="recent-activity-time">{formatRelativeTime(getTimestamp(item))}</span>
					</div>
				)}
			</For>
		</div>
	);
}
