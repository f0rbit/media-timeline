import { For, Show, createEffect, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import { type ProfileSummary, initMockAuth, profiles } from "../../utils/api";

type AuthState = { authenticated: true; profiles: ProfileSummary[] } | { authenticated: false };

export type ProfileSelectorProps = {
	currentSlug: string | null;
	initialProfiles?: ProfileSummary[];
	isAuthenticated?: boolean;
};

const fetchAuthAndProfiles = async (initial?: AuthState): Promise<AuthState> => {
	// If we have SSR data, use it directly without fetching
	if (initial !== undefined) {
		return initial;
	}

	initMockAuth();

	const result = await profiles.list();
	if (!result.ok) {
		if (result.error.status === 401) {
			return { authenticated: false };
		}
		console.error("[ProfileSelector] Failed to fetch profiles:", result.error);
		return { authenticated: true, profiles: [] };
	}
	return { authenticated: true, profiles: result.value.profiles };
};

const getSlugFromUrl = () => {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get("profile");
};

const buildUrl = (path: string, slug: string | null) => {
	if (!slug) return path;
	return `${path}?profile=${encodeURIComponent(slug)}`;
};

export default function ProfileSelector(props: ProfileSelectorProps) {
	const [isOpen, setIsOpen] = createSignal(false);

	const initialState = (): AuthState | undefined => {
		if (props.initialProfiles !== undefined) {
			return props.isAuthenticated !== false ? { authenticated: true, profiles: props.initialProfiles } : { authenticated: false };
		}
		return undefined;
	};

	const [authState] = createResource(
		() => initialState(),
		initial => fetchAuthAndProfiles(initial)
	);

	const currentSlug = () => getSlugFromUrl() ?? props.currentSlug;
	let containerRef: HTMLDivElement | undefined;

	const hasInitialData = () => props.initialProfiles !== undefined;

	const profileList = () => {
		if (hasInitialData() && !authState()) {
			return props.initialProfiles ?? [];
		}
		const state = authState();
		if (!state?.authenticated) return props.initialProfiles ?? [];
		return state.profiles;
	};

	const isAuthenticated = () => {
		const state = authState();

		// If resource has loaded, trust its result
		if (state !== undefined) {
			return state.authenticated;
		}

		// If SSR passed explicit auth data, use it during loading
		if (props.isAuthenticated !== undefined) {
			return props.isAuthenticated;
		}

		// If we have initial profiles from SSR, user is authenticated
		if (props.initialProfiles !== undefined && props.initialProfiles.length > 0) {
			return true;
		}

		// No data yet - default to false (show Login button)
		return false;
	};

	const currentProfile = () => {
		const slug = currentSlug();
		if (!slug) return null;
		return profileList().find(p => p.slug === slug) ?? null;
	};

	const buttonLabel = () => {
		if (!hasInitialData() && authState.loading) return "Loading...";
		const profile = currentProfile();
		return profile?.name ?? "Select Profile";
	};

	createEffect(
		on(
			() => authState(),
			state => {
				if (!state?.authenticated) return;
				const list = state.profiles;
				if (list.length === 0) return;
				if (currentSlug()) return;

				const firstProfile = list[0];
				if (!firstProfile) return;

				const url = new URL(window.location.href);
				url.searchParams.set("profile", firstProfile.slug);
				window.location.href = url.toString();
			}
		)
	);

	const handleSelect = (slug: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("profile", slug);
		window.location.href = url.toString();
		setIsOpen(false);
	};

	const handleLogin = () => {
		window.location.href = "/media/api/auth/login";
	};

	const handleClickOutside = (e: MouseEvent) => {
		if (!containerRef?.contains(e.target as Node)) {
			setIsOpen(false);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") setIsOpen(false);
	};

	onMount(() => {
		document.addEventListener("click", handleClickOutside);
		document.addEventListener("keydown", handleKeyDown);

		onCleanup(() => {
			document.removeEventListener("click", handleClickOutside);
			document.removeEventListener("keydown", handleKeyDown);
		});
	});

	const hasNoProfiles = () => {
		if (!hasInitialData() && authState.loading) return false;
		if (!isAuthenticated()) return false;
		return profileList().length === 0;
	};

	const isLoading = () => !hasInitialData() && authState.loading;

	return (
		<Show when={!isLoading()} fallback={<div class="auth-loading" />}>
			<Show
				when={isAuthenticated()}
				fallback={
					<button onClick={handleLogin} class="auth-btn login-btn">
						Login
					</button>
				}
			>
				<Show
					when={!hasNoProfiles()}
					fallback={
						<a href={buildUrl("/connections", currentSlug())} class="profile-selector-create-link">
							<PlusIcon />
							<span>Create Profile</span>
						</a>
					}
				>
					<div class="profile-selector" ref={containerRef}>
						<button class="profile-selector-button" onClick={() => setIsOpen(!isOpen())} aria-expanded={isOpen()} aria-haspopup="menu" type="button">
							<ProfileIcon />
							<span class="profile-selector-label">{buttonLabel()}</span>
							<ChevronDownIcon />
						</button>

						<Show when={isOpen()}>
							<div class="profile-selector-dropdown">
								<Show when={profileList().length > 0}>
									<For each={profileList()}>
										{profile => (
											<button class={`profile-selector-item ${currentSlug() === profile.slug ? "active" : ""}`} onClick={() => handleSelect(profile.slug)} type="button">
												<span class="profile-selector-radio">{currentSlug() === profile.slug ? <CheckIcon /> : null}</span>
												<span>{profile.name}</span>
											</button>
										)}
									</For>

									<div class="profile-selector-divider" />

									<a href={buildUrl("/connections", currentSlug())} class="profile-selector-item profile-selector-create">
										<PlusIcon />
										<span>Manage Profiles</span>
									</a>
								</Show>
							</div>
						</Show>
					</div>
				</Show>
			</Show>
		</Show>
	);
}

function ProfileIcon() {
	return (
		<svg class="profile-selector-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M22 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</svg>
	);
}

function ChevronDownIcon() {
	return (
		<svg class="profile-selector-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M20 6 9 17l-5-5" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
	);
}
