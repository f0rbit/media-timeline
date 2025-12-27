export type ConnectionState = "not_configured" | "inactive" | "active" | "error";

type Props = {
	state: ConnectionState;
};

const STATE_CONFIG: Record<ConnectionState, { label: string; className: string; icon: string }> = {
	not_configured: { label: "Not Connected", className: "status-not-connected", icon: "\u25CB" },
	inactive: { label: "Inactive", className: "status-inactive", icon: "\u25CB" },
	active: { label: "Active", className: "status-active", icon: "\u25CF" },
	error: { label: "Error", className: "status-error", icon: "\u25CF" },
};

export default function StatusBadge(props: Props) {
	const config = () => STATE_CONFIG[props.state];

	return (
		<span class={`status-badge ${config().className}`}>
			<span class="status-icon">{config().icon}</span>
			<span class="status-label">{config().label}</span>
		</span>
	);
}
