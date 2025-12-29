import type { DashboardStats as Stats } from "@/utils/analytics";
import { formatRelativeTime } from "@/utils/formatters";
import StatCard from "./StatCard";

type Props = {
	stats: Stats;
};

export default function DashboardStats(props: Props) {
	return (
		<div class="stats-row">
			<StatCard value={props.stats.totalEntries} label="total entries" />
			<StatCard value={props.stats.activeDays} label="active days" />
			<StatCard value={props.stats.platforms.length} label="platforms" />
			<StatCard value={props.stats.lastActivity ? formatRelativeTime(props.stats.lastActivity) : "—"} label="last active" />
		</div>
	);
}
