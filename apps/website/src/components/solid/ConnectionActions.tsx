import { connections } from "@/utils/api-client";
import { Show, createSignal } from "solid-js";

type Props = {
	accountId: string;
	isActive: boolean;
	state: "active" | "inactive";
	onAction: () => void;
};

export default function ConnectionActions(props: Props) {
	const [refreshing, setRefreshing] = createSignal(false);
	const [toggling, setToggling] = createSignal(false);
	const [deleting, setDeleting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleRefresh = async () => {
		setRefreshing(true);
		setError(null);
		const result = await connections.refresh(props.accountId);
		setRefreshing(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	const handleToggle = async () => {
		setToggling(true);
		setError(null);
		const result = await connections.update(props.accountId, { is_active: !props.isActive });
		setToggling(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	const handleDelete = async () => {
		if (!confirm("Remove this connection? This cannot be undone.")) return;
		setDeleting(true);
		setError(null);
		const result = await connections.delete(props.accountId);
		setDeleting(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		props.onAction();
	};

	return (
		<>
			<div class="flex-row icons">
				<Show when={props.state === "active"}>
					<button class="icon-btn" onClick={handleRefresh} disabled={refreshing()} title="Refresh data">
						<RefreshIcon spinning={refreshing()} />
					</button>
					<button class="icon-btn" onClick={handleToggle} disabled={toggling()} title="Pause syncing">
						<PauseIcon />
					</button>
				</Show>
				<Show when={props.state === "inactive"}>
					<button class="icon-btn" onClick={handleToggle} disabled={toggling()} title="Resume syncing">
						<PlayIcon />
					</button>
				</Show>
				<button class="icon-btn" onClick={handleDelete} disabled={deleting()} title="Remove connection">
					<TrashIcon />
				</button>
			</div>
			<Show when={error()}>
				<small class="error-text">{error()}</small>
			</Show>
		</>
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

function PauseIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="14" y="4" width="4" height="16" rx="1" />
			<rect x="6" y="4" width="4" height="16" rx="1" />
		</svg>
	);
}

function PlayIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polygon points="6 3 20 12 6 21 6 3" />
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
