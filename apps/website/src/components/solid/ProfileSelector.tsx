import { createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { initMockAuth, profiles, type ProfileSummary } from "../../utils/api-client";

const fetchProfiles = async (): Promise<ProfileSummary[]> => {
	if (typeof window === "undefined") return [];
	const result = await profiles.list();
	if (!result.ok) {
		console.error("[ProfileSelector] Failed to fetch profiles:", result.error);
		return [];
	}
	return result.data.profiles;
};

export default function ProfileSelector() {
	initMockAuth();

	const currentSlug = () => {
		if (typeof window === "undefined") return null;
		const params = new URLSearchParams(window.location.search);
		return params.get("profile");
	};

	const [isOpen, setIsOpen] = createSignal(false);
	const [profileList] = createResource(fetchProfiles);
	let containerRef: HTMLDivElement | undefined;

	const currentProfile = () => {
		const slug = currentSlug();
		if (!slug) return null;
		return profileList()?.find(p => p.slug === slug) ?? null;
	};

	const buttonLabel = () => {
		if (profileList.loading) return "Loading...";
		const profile = currentProfile();
		return profile?.name ?? "Loading...";
	};

	createEffect(
		on(
			() => profileList(),
			list => {
				if (!list || list.length === 0) return;
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
		if (profileList.loading) return false;
		const list = profileList();
		return list !== undefined && list.length === 0;
	};

	return (
		<Show
			when={!hasNoProfiles()}
			fallback={
				<a href="/connections" class="profile-selector-create-link">
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
						<Show when={profileList.loading}>
							<div class="profile-selector-item profile-selector-loading">Loading...</div>
						</Show>

						<Show when={!profileList.loading && (profileList()?.length ?? 0) > 0}>
							<For each={profileList()}>
								{profile => (
									<button class={`profile-selector-item ${currentSlug() === profile.slug ? "active" : ""}`} onClick={() => handleSelect(profile.slug)} type="button">
										<span class="profile-selector-radio">{currentSlug() === profile.slug ? <CheckIcon /> : null}</span>
										<span>{profile.name}</span>
									</button>
								)}
							</For>

							<div class="profile-selector-divider" />

							<a href="/connections" class="profile-selector-item profile-selector-create">
								<PlusIcon />
								<span>Manage Profiles</span>
							</a>
						</Show>
					</div>
				</Show>
			</div>
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
