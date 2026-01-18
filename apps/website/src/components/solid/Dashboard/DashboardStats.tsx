import type { DashboardStats as Stats } from "@/utils/analytics";
import { formatRelativeTime } from "@/utils/formatters";
import { Stat } from "@f0rbit/ui";

type Props = {
	stats: Stats;
};

export default function DashboardStats(props: Props) {
	return (
		<div class="stats-row">
			<Stat value={props.stats.totalEntries} label="total entries" />
			<Stat value={props.stats.activeDays} label="active days" />
			<Stat value={props.stats.platforms.length} label="platforms" />
			<Stat value={props.stats.lastActivity ? formatRelativeTime(props.stats.lastActivity) : "—"} label="last active" />
		</div>
	);
}
