type StatCardProps = {
	value: string | number;
	label: string;
};

export default function StatCard(props: StatCardProps) {
	return (
		<div class="stat-card">
			<span class="stat-value">{props.value}</span>
			<span class="stat-label">{props.label}</span>
		</div>
	);
}
