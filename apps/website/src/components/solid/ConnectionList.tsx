import { createResource, For, Show } from "solid-js";
import { connections, initMockAuth, type ApiResult, type ConnectionsResponse } from "@/utils/api-client";
import ConnectionCard from "./ConnectionCard";

export default function ConnectionList() {
	initMockAuth();

	const [data, { refetch }] = createResource(async () => {
		const result: ApiResult<ConnectionsResponse> = await connections.list();
		if (result.ok === false) throw new Error(result.error.message);
		return result.data.accounts;
	});

	return (
		<div class="flex-col">
			<Show when={data.loading}>
				<p class="tertiary">Loading connections...</p>
			</Show>

			<Show when={data.error}>
				<p class="error-icon">Failed to load connections: {data.error.message}</p>
			</Show>

			<Show when={data() && data()!.length > 0}>
				<For each={data()}>{conn => <ConnectionCard connection={conn} onRefresh={refetch} onDelete={refetch} />}</For>
			</Show>

			<Show when={data() && data()!.length === 0}>
				<div class="empty-state">
					<p>No connections yet.</p>
					<a href="/connections/new">Add your first connection</a>
				</div>
			</Show>
		</div>
	);
}
