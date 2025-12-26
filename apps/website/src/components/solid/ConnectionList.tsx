import { createResource, For, Show } from "solid-js";
import { connections, initMockAuth, type ConnectionWithSettings } from "@/utils/api-client";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";

const PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad"];

export default function ConnectionList() {
	initMockAuth();

	const [data, { refetch }] = createResource(async () => {
		const result = await connections.listWithSettings();
		if (!result.ok) throw new Error(result.error.message);
		return result.data.accounts;
	});

	const getConnection = (platform: Platform): ConnectionWithSettings | null => {
		return data()?.find(c => c.platform === platform) ?? null;
	};

	return (
		<div class="flex-col">
			<Show when={data.loading}>
				<p class="tertiary">Loading connections...</p>
			</Show>

			<Show when={data.error}>
				<p class="error-icon">Failed to load connections: {data.error.message}</p>
			</Show>

			<Show when={!data.loading && !data.error}>
				<For each={PLATFORMS}>{platform => <PlatformCard platform={platform} connection={getConnection(platform)} onConnectionChange={refetch} />}</For>
			</Show>
		</div>
	);
}
