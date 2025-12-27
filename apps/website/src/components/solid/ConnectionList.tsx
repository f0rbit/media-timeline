import { createResource, For, Show } from "solid-js";
import { type ConnectionWithSettings, connections, initMockAuth } from "@/utils/api-client";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";

const PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad", "reddit", "twitter"];

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

	// Sort platforms: connected/active first, then not configured
	const sortedPlatforms = () => {
		const accounts = data();
		if (!accounts) return PLATFORMS;

		return [...PLATFORMS].sort((a, b) => {
			const connA = accounts.find(c => c.platform === a);
			const connB = accounts.find(c => c.platform === b);

			// Connected platforms come first
			if (connA && !connB) return -1;
			if (!connA && connB) return 1;

			// Among connected, active comes before inactive
			if (connA && connB) {
				if (connA.is_active && !connB.is_active) return -1;
				if (!connA.is_active && connB.is_active) return 1;
			}

			return 0;
		});
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
				<For each={sortedPlatforms()}>{platform => <PlatformCard platform={platform} connection={getConnection(platform)} onConnectionChange={refetch} />}</For>
			</Show>
		</div>
	);
}
