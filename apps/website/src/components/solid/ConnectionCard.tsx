import { createSignal } from "solid-js";
import { connections, type Connection } from "@/utils/api-client";
import { formatRelativeTime, formatPlatformName } from "@/utils/formatters";

type Props = {
	connection: Connection;
	onRefresh: () => void;
	onDelete: () => void;
};

export default function ConnectionCard(props: Props) {
	const [deleting, setDeleting] = createSignal(false);
	const [refreshing, setRefreshing] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleDelete = async () => {
		if (!confirm("Are you sure you want to remove this connection?")) return;

		setDeleting(true);
		setError(null);

		const result = await connections.delete(props.connection.account_id);

		if (result.ok === false) {
			setError(result.error.message);
			setDeleting(false);
			return;
		}

		props.onDelete();
	};

	const handleRefresh = async () => {
		setRefreshing(true);
		setError(null);

		const result = await connections.refresh(props.connection.account_id);

		if (result.ok === false) {
			setError(result.error.message);
		}

		setRefreshing(false);
		props.onRefresh();
	};

	return (
		<div class={`card platform-${props.connection.platform}`}>
			<div class="flex-row" style={{ "justify-content": "space-between" }}>
				<div class="flex-row" style={{ gap: "12px" }}>
					<PlatformIcon platform={props.connection.platform} />
					<div class="flex-col" style={{ gap: "2px" }}>
						<h6>{formatPlatformName(props.connection.platform)}</h6>
						<span class="description">{props.connection.platform_username ?? "Connected"}</span>
					</div>
				</div>
				<div class="flex-row icons">
					<button class="icon-btn" onClick={handleRefresh} disabled={refreshing()} title="Refresh data">
						<RefreshIcon spinning={refreshing()} />
					</button>
					<button class="icon-btn" onClick={handleDelete} disabled={deleting()} title="Remove connection">
						<TrashIcon />
					</button>
				</div>
			</div>

			{props.connection.last_fetched_at && <small class="description">Last synced: {formatRelativeTime(props.connection.last_fetched_at)}</small>}

			{error() && <small class="error-icon">{error()}</small>}
		</div>
	);
}

function RefreshIcon(props: { spinning?: boolean }) {
	return (
		<svg
			class={props.spinning ? "lucide spinner" : "lucide"}
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
			<path d="M21 3v5h-5" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M3 6h18" />
			<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
			<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
		</svg>
	);
}

function PlatformIcon(props: { platform: string }) {
	const iconClass = `platform-icon platform-${props.platform}`;
	return <span class={iconClass}>{props.platform.charAt(0).toUpperCase()}</span>;
}
