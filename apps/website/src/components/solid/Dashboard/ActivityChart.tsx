import type { WeeklyActivity } from "@/utils/analytics";
import type { CommitGroup, TimelineItem } from "@/utils/api-client";
import { formatRelativeTime } from "@/utils/formatters";
import { For, Show } from "solid-js";
import PlatformIcon from "../PlatformIcon";

type ActivityChartProps = {
	activity: WeeklyActivity[];
	onSelectDate?: (date: string) => void;
	selectedDate?: string | null;
	maxCount: number;
};

type ActivityPreviewProps = {
	date: string;
	items: (TimelineItem | CommitGroup)[];
};

const formatDate = (dateStr: string): string => {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatFullDate = (dateStr: string): string => {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};

const formatMonth = (dateStr: string): string => {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", { month: "short" });
};

// Get intensity level 0-4 based on count relative to max
const getIntensity = (count: number, max: number): number => {
	if (count === 0) return 0;
	if (max === 0) return 0;
	const ratio = count / max;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
};

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

// Cell size + gap = 14px per week (11px cell + 3px gap)
const WEEK_WIDTH = 14;
const DAY_LABEL_WIDTH = 28;

export default function ActivityChart(props: ActivityChartProps) {
	// Get month labels - show each month once, at its first week occurrence (left to right)
	// Skip the first month if it's a duplicate of a later month (handles year boundary)
	const monthLabels = () => {
		const labels: { month: string; weekIndex: number }[] = [];
		let lastMonth = "";

		// First pass: collect all month transitions
		props.activity.forEach((week, idx) => {
			if (week.days.length > 0) {
				const month = formatMonth(week.days[0].date);
				if (month !== lastMonth) {
					labels.push({ month, weekIndex: idx });
					lastMonth = month;
				}
			}
		});

		// If we have more than 12 months, skip the first one (it's a duplicate from previous year)
		if (labels.length > 12) {
			return labels.slice(1);
		}

		return labels;
	};

	return (
		<div>
			{/* Month labels row */}
			<div class="activity-grid-header">
				<div class="activity-grid-day-spacer" />
				<div class="activity-grid-months">
					<For each={monthLabels()}>
						{label => (
							<span class="activity-month-label" style={{ left: `${label.weekIndex * WEEK_WIDTH}px` }}>
								{label.month}
							</span>
						)}
					</For>
				</div>
			</div>

			{/* Main grid with day labels */}
			<div class="activity-grid-main">
				{/* Day labels (Mon, Wed, Fri) */}
				<div class="activity-grid-day-labels">
					<For each={DAY_LABELS}>{label => <span class="activity-day-label">{label}</span>}</For>
				</div>

				{/* Grid of weeks */}
				<div class="activity-grid">
					<For each={props.activity}>
						{week => (
							<div class="activity-week">
								<For each={week.days}>
									{day => {
										const intensity = () => getIntensity(day.count, props.maxCount);
										const isSelected = () => props.selectedDate === day.date;

										return (
											<button
												type="button"
												class={`activity-cell activity-cell-${intensity()} ${isSelected() ? "activity-cell-selected" : ""}`}
												title={`${formatDate(day.date)}: ${day.count} entries`}
												onClick={() => props.onSelectDate?.(day.date)}
											/>
										);
									}}
								</For>
							</div>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}

export function ActivityPreview(props: ActivityPreviewProps) {
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

	return (
		<div class="activity-preview">
			<div class="activity-preview-header">
				<span class="activity-preview-date">{formatFullDate(props.date)}</span>
				<span class="activity-preview-count">{props.items.length} entries</span>
			</div>
			<Show when={props.items.length > 0} fallback={<p class="muted text-sm">No activity on this day.</p>}>
				<div class="activity-preview-list">
					<For each={props.items.slice(0, 10)}>
						{item => (
							<div class="activity-preview-item">
								<div class="activity-preview-icon">
									<PlatformIcon platform={getPlatform(item)} size={14} />
								</div>
								<span class="activity-preview-title">{getTitle(item)}</span>
								<span class="activity-preview-time">{formatRelativeTime(getTimestamp(item))}</span>
							</div>
						)}
					</For>
					<Show when={props.items.length > 10}>
						<p class="muted text-sm">And {props.items.length - 10} more...</p>
					</Show>
				</div>
			</Show>
		</div>
	);
}
