import { type AccountVisibility, type ConnectionWithSettings, connections, initMockAuth, profiles } from "@/utils/api-client";
import { For, Show, createEffect, createResource, createSignal, on } from "solid-js";
import { isServer } from "solid-js/web";
import PlatformCard from "./PlatformCard";
import type { Platform } from "./PlatformSetupForm";

const ALL_PLATFORMS: Platform[] = ["github", "bluesky", "youtube", "devpad", "reddit", "twitter"];
const HIDDEN_PLATFORMS: Platform[] = ["bluesky", "youtube", "devpad"];
const PLATFORMS = ALL_PLATFORMS.filter(p => !HIDDEN_PLATFORMS.includes(p));

type VisibilityMap = Map<string, AccountVisibility>;

function VisibilityBadge(props: { isVisible: boolean; loading?: boolean; onToggle?: () => void }) {
	const badgeClass = () => `visibility-badge ${props.isVisible ? "visible" : "hidden"}`;

	return (
		<button type="button" class={badgeClass()} onClick={props.onToggle} disabled={props.loading}>
			{props.loading ? "..." : props.isVisible ? "Visible" : "Hidden"}
		</button>
	);
}

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

export default function ConnectionList(props: { profileSlug?: string | null }) {
	if (!isServer) {
		initMockAuth();
	}

	const profileSlug = () => props.profileSlug ?? null;

	const [profileId, setProfileId] = createSignal<string | null>(null);
	const [visibilityMap, setVisibilityMap] = createSignal<VisibilityMap>(new Map());
	const [togglingAccount, setTogglingAccount] = createSignal<string | null>(null);

	const [data, { refetch }] = createResource(
		() => !isServer,
		async () => {
			const result = await connections.listWithSettings();
			if (!result.ok) throw new Error(result.error.message);
			return result.data.accounts;
		}
	);

	const [profileList] = createResource(
		() => !isServer,
		async () => {
			const result = await profiles.list();
			if (!result.ok) return [];
			return result.data.profiles;
		}
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
			async ([slug, list]) => {
				if (isServer) return;

				if (!slug || !list) {
					setProfileId(null);
					setVisibilityMap(new Map());
					return;
				}

				const profile = list.find(p => p.slug === slug);
				if (!profile) {
					setProfileId(null);
					setVisibilityMap(new Map());
					return;
				}

				setProfileId(profile.id);

				const visResult = await profiles.getVisibility(profile.id);
				if (!visResult.ok) return;

				const newMap = new Map<string, AccountVisibility>();
				for (const v of visResult.data.visibility) {
					newMap.set(v.account_id, v);
				}
				setVisibilityMap(newMap);
			}
		)
	);

	const getConnection = (platform: Platform): ConnectionWithSettings | null => {
		return data()?.find(c => c.platform === platform) ?? null;
	};

	const getVisibility = (accountId: string): AccountVisibility | null => {
		return visibilityMap().get(accountId) ?? null;
	};

	const toggleVisibility = async (accountId: string) => {
		const id = profileId();
		if (!id) return;

		const current = visibilityMap().get(accountId);
		const newValue = !(current?.is_visible ?? true);

		setTogglingAccount(accountId);

		const result = await profiles.updateVisibility(id, [{ account_id: accountId, is_visible: newValue }]);

		if (result.ok) {
			setVisibilityMap(prev => {
				const updated = new Map(prev);
				const existing = updated.get(accountId);
				if (existing) {
					updated.set(accountId, { ...existing, is_visible: newValue });
				}
				return updated;
			});
		}

		setTogglingAccount(null);
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
				<div class="visibility-mode-banner">
					<span class="text-sm tertiary">
						Editing visibility for: <strong class="secondary">{currentProfile()?.name ?? profileSlug()}</strong>
					</span>
				</div>

				<Show when={data.loading}>
					<p class="tertiary">Loading connections...</p>
				</Show>

				<Show when={data.error}>
					<p class="error-icon">Failed to load connections: {data.error.message}</p>
				</Show>

				<Show when={!data.loading && !data.error}>
					<For each={sortedPlatforms()}>
						{platform => {
							const connection = (): ConnectionWithSettings | null => getConnection(platform);

							const getAccountId = (): string | null => {
								const conn = connection();
								return conn ? conn.account_id : null;
							};

							const visibility = (): AccountVisibility | null => {
								const accountId = getAccountId();
								return accountId ? getVisibility(accountId) : null;
							};

							const isToggling = (): boolean => {
								const accountId = getAccountId();
								return accountId !== null && togglingAccount() === accountId;
							};

							const isVisible = (): boolean => {
								const vis = visibility();
								return vis?.is_visible ?? true;
							};

							const handleToggle = () => {
								const accountId = getAccountId();
								if (accountId) {
									toggleVisibility(accountId);
								}
							};

							return (
								<div class="connection-with-visibility">
									<PlatformCard platform={platform} connection={connection()} onConnectionChange={refetch} />
									<Show when={connection()}>
										<div class="visibility-overlay">
											<VisibilityBadge isVisible={isVisible()} loading={isToggling()} onToggle={handleToggle} />
										</div>
									</Show>
								</div>
							);
						}}
					</For>
				</Show>
			</Show>
		</div>
	);
}
