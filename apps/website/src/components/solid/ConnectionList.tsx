import { type ConnectionWithSettings, connections, initMockAuth, profiles } from "@/utils/api-client";
import { For, Show, createEffect, createResource, createSignal, on } from "solid-js";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";

const ALL_PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad", "reddit", "twitter"];
const HIDDEN_PLATFORMS: Platform[] = ["bluesky", "youtube", "devpad"];
const PLATFORMS = ALL_PLATFORMS.filter(p => !HIDDEN_PLATFORMS.includes(p));

const getSlugFromUrl = () => {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get("profile");
};

function NoProfileSelectedError() {
	return (
		<div class="error-state">
			<p class="error-icon">No profile selected. Please select a profile or create one.</p>
			<a href="/connections" class="btn btn-primary">
				Manage Profiles
			</a>
		</div>
	);
}

export default function ConnectionList() {
	const profileSlug = () => getSlugFromUrl();
	const [profileId, setProfileId] = createSignal<string | null>(null);

	const [profileList] = createResource(async () => {
		initMockAuth();
		const result = await profiles.list();
		if (!result.ok) return [];
		return result.value.profiles;
	});

	const currentProfile = () => {
		const slug = profileSlug();
		const list = profileList();
		if (!slug || !list) return null;
		return list.find(p => p.slug === slug) ?? null;
	};

	createEffect(
		on(
			() => [profileSlug(), profileList()] as const,
			([slug, list]) => {
				if (!slug || !list) {
					setProfileId(null);
					return;
				}
				const profile = list.find(p => p.slug === slug);
				setProfileId(profile?.id ?? null);
			}
		)
	);

	const [data, { refetch }] = createResource(
		() => profileId(),
		async id => {
			if (!id) return [];
			initMockAuth();
			const result = await connections.listWithSettings(id);
			if (!result.ok) throw new Error(result.error.message);
			return result.value.accounts;
		}
	);

	const getConnection = (platform: Platform): ConnectionWithSettings | null => {
		return data()?.find(c => c.platform === platform) ?? null;
	};

	const sortedPlatforms = () => {
		const accounts = data();
		if (!accounts) return PLATFORMS;

		return [...PLATFORMS].sort((a, b) => {
			const connA = accounts.find(c => c.platform === a);
			const connB = accounts.find(c => c.platform === b);

			if (connA && !connB) return -1;
			if (!connA && connB) return 1;

			if (connA && connB) {
				if (connA.is_active && !connB.is_active) return -1;
				if (!connA.is_active && connB.is_active) return 1;
			}

			return 0;
		});
	};

	const hasValidProfile = () => !!profileSlug() && !!currentProfile();

	return (
		<div class="flex-col">
			<Show when={!profileSlug()}>
				<NoProfileSelectedError />
			</Show>

			<Show when={profileSlug() && !profileList.loading && !currentProfile()}>
				<NoProfileSelectedError />
			</Show>

			<Show when={hasValidProfile()}>
				<Show when={data.loading}>
					<p class="tertiary">Loading connections...</p>
				</Show>

				<Show when={data.error}>
					<p class="error-icon">Failed to load connections: {data.error.message}</p>
				</Show>

				<Show when={!data.loading && !data.error && profileId()} keyed>
					{id => <For each={sortedPlatforms()}>{platform => <PlatformCard platform={platform} profileId={id} connection={getConnection(platform)} onConnectionChange={refetch} />}</For>}
				</Show>
			</Show>
		</div>
	);
}
