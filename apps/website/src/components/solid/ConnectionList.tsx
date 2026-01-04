import { type ConnectionWithSettings, type ProfileSummary, connections, initMockAuth, profiles } from "@/utils/api";
import { For, Show, createEffect, createResource, createSignal, on } from "solid-js";
import { isServer } from "solid-js/web";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";

const ALL_PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad", "reddit", "twitter"];
const HIDDEN_PLATFORMS: Platform[] = ["bluesky", "youtube", "devpad"];
const PLATFORMS = ALL_PLATFORMS.filter(p => !HIDDEN_PLATFORMS.includes(p));

type ConnectionListProps = {
	profileSlug?: string | null;
	initialProfiles?: ProfileSummary[];
	initialConnections?: ConnectionWithSettings[];
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

export default function ConnectionList(props: ConnectionListProps) {
	const profileSlug = () => props.profileSlug ?? null;
	const [profileId, setProfileId] = createSignal<string | null>(null);

	const [profileFetchTrigger, setProfileFetchTrigger] = createSignal(0);
	const [profileList] = createResource(
		() => {
			const trigger = profileFetchTrigger();
			// Skip initial fetch if we have SSR data
			if (trigger === 0 && props.initialProfiles && props.initialProfiles.length > 0) {
				return null;
			}
			return trigger;
		},
		async () => {
			if (isServer) return [];
			initMockAuth();
			const result = await profiles.list();
			if (!result.ok) return [];
			return result.value.profiles;
		},
		{ initialValue: props.initialProfiles ?? [] }
	);

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

	const [connectionFetchTrigger, setConnectionFetchTrigger] = createSignal(0);
	const [data, { refetch }] = createResource(
		() => {
			const trigger = connectionFetchTrigger();
			const id = profileId();

			// Skip initial fetch if we have SSR data
			if (trigger === 0 && props.initialConnections) {
				return null;
			}

			return id;
		},
		async id => {
			if (isServer) return [];
			if (!id) return [];
			initMockAuth();
			const result = await connections.listWithSettings(id);
			if (!result.ok) throw new Error(result.error.message);
			return result.value.accounts;
		},
		{ initialValue: props.initialConnections ?? [] }
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
