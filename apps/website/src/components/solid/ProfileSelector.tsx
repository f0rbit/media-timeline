import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { isServer } from "solid-js/web";
import { profiles, type ProfileSummary } from "../../utils/api-client";

type ProfileSelectorProps = {
	currentSlug: string | null;
};

const fetchProfiles = async (): Promise<ProfileSummary[]> => {
	if (isServer) return [];
	const result = await profiles.list();
	if (!result.ok) return [];
	return result.data.profiles;
};

export default function ProfileSelector(props: ProfileSelectorProps) {
	const [isOpen, setIsOpen] = createSignal(false);
	const [profileList] = createResource(fetchProfiles);
	let containerRef: HTMLDivElement | undefined;

	const currentProfile = () => {
		if (!props.currentSlug) return null;
		return profileList()?.find(p => p.slug === props.currentSlug) ?? null;
	};

	const handleSelect = (slug: string | null) => {
		const url = new URL(window.location.href);
		if (slug) {
			url.searchParams.set("profile", slug);
		} else {
			url.searchParams.delete("profile");
		}
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

	return (
		<div class="profile-selector" ref={containerRef}>
			<button class="profile-selector-button" onClick={() => setIsOpen(!isOpen())} aria-expanded={isOpen()} aria-haspopup="menu" type="button">
				<ProfileIcon />
				<span class="profile-selector-label">{currentProfile()?.name ?? "All Accounts"}</span>
				<ChevronDownIcon />
			</button>

			<Show when={isOpen()}>
				<div class="profile-selector-dropdown">
					<Show when={profileList.loading}>
						<div class="profile-selector-item profile-selector-loading">Loading...</div>
					</Show>

					<Show when={!profileList.loading}>
						<button class={`profile-selector-item ${!props.currentSlug ? "active" : ""}`} onClick={() => handleSelect(null)} type="button">
							<span class="profile-selector-radio">{!props.currentSlug ? <CheckIcon /> : null}</span>
							<span>All Accounts</span>
						</button>

						<Show when={(profileList()?.length ?? 0) > 0}>
							<div class="profile-selector-divider" />

							<For each={profileList()}>
								{profile => (
									<button class={`profile-selector-item ${props.currentSlug === profile.slug ? "active" : ""}`} onClick={() => handleSelect(profile.slug)} type="button">
										<span class="profile-selector-radio">{props.currentSlug === profile.slug ? <CheckIcon /> : null}</span>
										<span>{profile.name}</span>
									</button>
								)}
							</For>
						</Show>

						<div class="profile-selector-divider" />

						<a href="/connections" class="profile-selector-item profile-selector-create">
							<PlusIcon />
							<span>Create Profile</span>
						</a>
					</Show>
				</div>
			</Show>
		</div>
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
