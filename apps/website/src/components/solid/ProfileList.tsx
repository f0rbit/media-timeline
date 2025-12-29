import { api, initMockAuth } from "@/utils/api-client";
import { For, Show, createResource, createSignal } from "solid-js";

type ProfileFilter = {
	id: string;
	account_id: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

type Profile = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	filters?: ProfileFilter[];
};

type ProfilesResponse = {
	profiles: Profile[];
};

type CreateProfileResponse = {
	profile: Profile;
};

const API_BASE_URL = "https://media.devpad.tools";

const fetchProfiles = async (): Promise<Profile[]> => {
	initMockAuth();
	const result = await api.get<ProfilesResponse>("/profiles");
	if (!result.ok) {
		console.error("[ProfileList] Failed to fetch profiles:", result.error);
		throw new Error(result.error.message);
	}
	return result.data.profiles;
};

const createProfile = async (data: { slug: string; name: string; description?: string }): Promise<Profile> => {
	const result = await api.post<CreateProfileResponse>("/profiles", data);
	if (!result.ok) throw new Error(result.error.message);
	return result.data.profile;
};

const deleteProfile = async (id: string): Promise<void> => {
	const result = await api.delete<{ deleted: boolean }>(`/profiles/${id}`);
	if (!result.ok) throw new Error(result.error.message);
};

const updateProfile = async (id: string, data: { slug?: string; name?: string; description?: string | null }): Promise<Profile> => {
	const result = await api.patch<{ profile: Profile }>(`/profiles/${id}`, data);
	if (!result.ok) throw new Error(result.error.message);
	return result.data.profile;
};

export type ProfileSummary = Profile;

// Read profile slug from URL
const getSlugFromUrl = () => {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get("profile");
};

export default function ProfileList() {
	const [profiles, { refetch }] = createResource(fetchProfiles);
	const currentSlug = () => getSlugFromUrl();
	const [editingProfile, setEditingProfile] = createSignal<Profile | null>(null);
	const [showCreateForm, setShowCreateForm] = createSignal(false);
	const [copiedSlug, setCopiedSlug] = createSignal<string | null>(null);

	const getApiEndpoint = (slug: string): string => `${API_BASE_URL}/api/v1/profiles/${slug}/timeline`;

	const handleCopy = async (slug: string) => {
		const endpoint = getApiEndpoint(slug);
		await navigator.clipboard.writeText(endpoint);
		setCopiedSlug(slug);
		setTimeout(() => setCopiedSlug(null), 2000);
	};

	const handleDelete = async (profile: Profile) => {
		if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return;
		await deleteProfile(profile.id);
		refetch();
	};

	const handleViewTimeline = (slug: string) => {
		window.location.href = `/timeline?profile=${encodeURIComponent(slug)}`;
	};

	return (
		<div class="flex-col">
			<div class="flex-row justify-between items-center">
				<h6 class="secondary font-medium">Your Profiles</h6>
				<button type="button" class="oauth-button" onClick={() => setShowCreateForm(true)} style={{ padding: "6px 12px", "font-size": "0.75rem" }}>
					<span class="flex-row" style={{ gap: "4px" }}>
						<PlusIcon />
						Create Profile
					</span>
				</button>
			</div>

			<Show when={showCreateForm()}>
				<CreateProfileForm
					onSuccess={() => {
						setShowCreateForm(false);
						refetch();
					}}
					onCancel={() => setShowCreateForm(false)}
				/>
			</Show>

			<Show when={profiles.loading}>
				<p class="tertiary">Loading profiles...</p>
			</Show>

			<Show when={profiles.error}>
				<p class="error-icon">Failed to load profiles: {profiles.error.message}</p>
			</Show>

			<Show when={!profiles.loading && !profiles.error && profiles()?.length === 0}>
				<div class="empty-state">
					<p class="muted">No profiles yet.</p>
					<p class="muted text-sm">Create a profile to share a curated timeline with specific platforms visible.</p>
				</div>
			</Show>

			<Show when={!profiles.loading && !profiles.error && (profiles()?.length ?? 0) > 0}>
				<For each={profiles()}>
					{profile => (
						<Show
							when={editingProfile()?.id === profile.id}
							fallback={
								<ProfileCard
									profile={profile}
									isCurrent={currentSlug() === profile.slug}
									onView={() => handleViewTimeline(profile.slug)}
									onEdit={() => setEditingProfile(profile)}
									onDelete={() => handleDelete(profile)}
									onCopy={() => handleCopy(profile.slug)}
									copied={copiedSlug() === profile.slug}
								/>
							}
						>
							<EditProfileForm
								profile={profile}
								onSuccess={() => {
									setEditingProfile(null);
									refetch();
								}}
								onCancel={() => setEditingProfile(null)}
							/>
						</Show>
					)}
				</For>
			</Show>
		</div>
	);
}

type ProfileCardProps = {
	profile: Profile;
	isCurrent: boolean;
	onView: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onCopy: () => void;
	copied: boolean;
};

function ProfileCard(props: ProfileCardProps) {
	const endpoint = `https://media.devpad.tools/api/v1/profiles/${props.profile.slug}/timeline`;

	return (
		<div class={`card ${props.isCurrent ? "card-active" : ""}`}>
			<div class="flex-col" style={{ gap: "8px" }}>
				<div class="flex-row justify-between items-start">
					<div class="flex-col" style={{ gap: "2px" }}>
						<div class="flex-row items-center" style={{ gap: "8px" }}>
							<h6 class="secondary font-medium">{props.profile.name}</h6>
							<Show when={props.isCurrent}>
								<span class="badge-active">Currently Viewing</span>
							</Show>
						</div>
						<span class="muted text-sm">/{props.profile.slug}</span>
					</div>
					<div class="flex-row icons">
						<button class="icon-btn" onClick={props.onView} title="View timeline">
							<EyeIcon />
						</button>
						<button class="icon-btn" onClick={props.onEdit} title="Edit profile">
							<EditIcon />
						</button>
						<button class="icon-btn" onClick={props.onDelete} title="Delete profile">
							<TrashIcon />
						</button>
					</div>
				</div>

				<Show when={props.profile.description}>
					<p class="tertiary text-sm">{props.profile.description}</p>
				</Show>

				<div class="flex-row items-center" style={{ gap: "8px", "margin-top": "4px" }}>
					<code class="text-xs mono truncate" style={{ flex: "1", padding: "4px 8px", background: "var(--input-background)", "border-radius": "4px", border: "1px solid var(--input-border)" }}>
						{endpoint}
					</code>
					<button class="icon-btn" onClick={props.onCopy} title={props.copied ? "Copied!" : "Copy endpoint"}>
						<Show when={props.copied} fallback={<CopyIcon />}>
							<CheckIcon />
						</Show>
					</button>
				</div>
			</div>
		</div>
	);
}

type CreateProfileFormProps = {
	onSuccess: () => void;
	onCancel: () => void;
};

function CreateProfileForm(props: CreateProfileFormProps) {
	const [name, setName] = createSignal("");
	const [slug, setSlug] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	const handleNameChange = (value: string) => {
		setName(value);
		const generatedSlug = value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		setSlug(generatedSlug);
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!name().trim() || !slug().trim()) {
			setError("Name and slug are required");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			await createProfile({
				name: name().trim(),
				slug: slug().trim(),
				description: description().trim() || undefined,
			});
			props.onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create profile");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class="card">
			<form class="flex-col" style={{ gap: "12px" }} onSubmit={handleSubmit}>
				<h6 class="secondary font-medium">Create New Profile</h6>

				<div class="form-row">
					<label class="text-sm tertiary">Name</label>
					<input type="text" value={name()} onInput={e => handleNameChange(e.currentTarget.value)} placeholder="My Public Timeline" />
				</div>

				<div class="form-row">
					<label class="text-sm tertiary">Slug (URL path)</label>
					<input type="text" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
				</div>

				<div class="form-row">
					<label class="text-sm tertiary">Description (optional)</label>
					<input type="text" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
				</div>

				<Show when={error()}>
					<p class="error-icon text-sm">{error()}</p>
				</Show>

				<div class="flex-row" style={{ gap: "8px", "justify-content": "flex-end" }}>
					<button type="button" class="button-reset tertiary" onClick={props.onCancel}>
						Cancel
					</button>
					<button type="submit" disabled={submitting()}>
						{submitting() ? "Creating..." : "Create Profile"}
					</button>
				</div>
			</form>
		</div>
	);
}

type EditProfileFormProps = {
	profile: Profile;
	onSuccess: () => void;
	onCancel: () => void;
};

function EditProfileForm(props: EditProfileFormProps) {
	const [name, setName] = createSignal(props.profile.name);
	const [slug, setSlug] = createSignal(props.profile.slug);
	const [description, setDescription] = createSignal(props.profile.description ?? "");
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!name().trim() || !slug().trim()) {
			setError("Name and slug are required");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			await updateProfile(props.profile.id, {
				name: name().trim(),
				slug: slug().trim(),
				description: description().trim() || null,
			});
			props.onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update profile");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class="card">
			<form class="flex-col" style={{ gap: "12px" }} onSubmit={handleSubmit}>
				<h6 class="secondary font-medium">Edit Profile</h6>

				<div class="form-row">
					<label class="text-sm tertiary">Name</label>
					<input type="text" value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="My Public Timeline" />
				</div>

				<div class="form-row">
					<label class="text-sm tertiary">Slug (URL path)</label>
					<input type="text" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
				</div>

				<div class="form-row">
					<label class="text-sm tertiary">Description (optional)</label>
					<input type="text" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
				</div>

				<Show when={error()}>
					<p class="error-icon text-sm">{error()}</p>
				</Show>

				<div class="flex-row" style={{ gap: "8px", "justify-content": "flex-end" }}>
					<button type="button" class="button-reset tertiary" onClick={props.onCancel}>
						Cancel
					</button>
					<button type="submit" disabled={submitting()}>
						{submitting() ? "Saving..." : "Save Changes"}
					</button>
				</div>
			</form>
		</div>
	);
}

function PlusIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
	);
}

function EyeIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function EditIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
			<path d="m15 5 4 4" />
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

function CopyIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg class="lucide success-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M20 6 9 17l-5-5" />
		</svg>
	);
}
