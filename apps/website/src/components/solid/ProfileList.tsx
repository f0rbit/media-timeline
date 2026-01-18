import { api, apiUrls, initMockAuth } from "@/utils/api";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Empty, FormField, Input, Spinner } from "@f0rbit/ui";
import { For, Show, createResource, createSignal } from "solid-js";
import { isServer } from "solid-js/web";

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

const fetchProfiles = async (): Promise<Profile[]> => {
	if (isServer) return [];
	initMockAuth();
	const result = await api.get<ProfilesResponse>("/profiles");
	if (!result.ok) {
		console.error("[ProfileList] Failed to fetch profiles:", result.error);
		throw new Error(result.error.message);
	}
	return result.value.profiles;
};

const createProfile = async (data: { slug: string; name: string; description?: string }): Promise<Profile> => {
	const result = await api.post<CreateProfileResponse>("/profiles", data);
	if (!result.ok) throw new Error(result.error.message);
	return result.value.profile;
};

const deleteProfile = async (id: string): Promise<void> => {
	const result = await api.delete<{ deleted: boolean }>(`/profiles/${id}`);
	if (!result.ok) throw new Error(result.error.message);
};

const updateProfile = async (id: string, data: { slug?: string; name?: string; description?: string | null }): Promise<Profile> => {
	const result = await api.patch<{ profile: Profile }>(`/profiles/${id}`, data);
	if (!result.ok) throw new Error(result.error.message);
	return result.value.profile;
};

export type ProfileSummary = Profile;

type ProfileListProps = {
	initialProfiles?: ProfileSummary[];
};

// Read profile slug from URL
const getSlugFromUrl = () => {
	if (isServer) return null;
	return new URLSearchParams(window.location.search).get("profile");
};

export default function ProfileList(props: ProfileListProps) {
	const [fetchTrigger, setFetchTrigger] = createSignal(0);

	const [profiles, { refetch }] = createResource(
		() => {
			const trigger = fetchTrigger();
			// Skip initial fetch if we have SSR data
			if (trigger === 0 && props.initialProfiles && props.initialProfiles.length > 0) {
				return null;
			}
			return trigger;
		},
		fetchProfiles,
		{ initialValue: props.initialProfiles ?? [] }
	);
	const currentSlug = () => getSlugFromUrl();
	const [editingProfile, setEditingProfile] = createSignal<Profile | null>(null);
	const [showCreateForm, setShowCreateForm] = createSignal(false);
	const [copiedSlug, setCopiedSlug] = createSignal<string | null>(null);

	const getApiEndpoint = (slug: string): string => `${apiUrls.profiles(`/${slug}/timeline`)}`;

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
				<Button size="sm" onClick={() => setShowCreateForm(true)}>
					<span class="flex-row" style={{ gap: "4px" }}>
						<PlusIcon />
						Create Profile
					</span>
				</Button>
			</div>

			<Show when={showCreateForm()}>
				<CreateProfileForm
					onSuccess={newProfile => {
						setShowCreateForm(false);
						// Reload page to refresh SSR components (ProfileSelector in header)
						// Navigate to the new profile
						window.location.href = `/connections?profile=${encodeURIComponent(newProfile.slug)}`;
					}}
					onCancel={() => setShowCreateForm(false)}
				/>
			</Show>

			<Show when={profiles.loading}>
				<div class="loading-state">
					<Spinner size="md" />
					<p class="tertiary">Loading profiles...</p>
				</div>
			</Show>

			<Show when={profiles.error}>
				<p class="error-icon">Failed to load profiles: {profiles.error.message}</p>
			</Show>

			<Show when={!profiles.loading && !profiles.error && profiles()?.length === 0}>
				<Empty title="No profiles yet" description="Create a profile to share a curated timeline with specific platforms visible." />
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
	const endpoint = apiUrls.profiles(`/${props.profile.slug}/timeline`);

	return (
		<Card class={props.isCurrent ? "card-active" : ""}>
			<CardHeader class="flex-row justify-between items-start">
				<div class="flex-col" style={{ gap: "2px" }}>
					<div class="flex-row items-center" style={{ gap: "8px" }}>
						<CardTitle>{props.profile.name}</CardTitle>
						<Show when={props.isCurrent}>
							<Badge variant="success">Currently Viewing</Badge>
						</Show>
					</div>
					<CardDescription>/{props.profile.slug}</CardDescription>
				</div>
				<div class="flex-row icons">
					<Button icon variant="ghost" label="View timeline" onClick={props.onView}>
						<EyeIcon />
					</Button>
					<Button icon variant="ghost" label="Edit profile" onClick={props.onEdit}>
						<EditIcon />
					</Button>
					<Button icon variant="ghost" label="Delete profile" onClick={props.onDelete}>
						<TrashIcon />
					</Button>
				</div>
			</CardHeader>

			<Show when={props.profile.description}>
				<CardContent>
					<p class="tertiary text-sm">{props.profile.description}</p>
				</CardContent>
			</Show>

			<CardFooter class="flex-row items-center" style={{ gap: "8px" }}>
				<code class="text-xs mono truncate" style={{ flex: "1", padding: "4px 8px", background: "var(--input-background)", "border-radius": "4px", border: "1px solid var(--input-border)" }}>
					{endpoint}
				</code>
				<Button icon variant="ghost" label={props.copied ? "Copied!" : "Copy endpoint"} onClick={props.onCopy}>
					<Show when={props.copied} fallback={<CopyIcon />}>
						<CheckIcon />
					</Show>
				</Button>
			</CardFooter>
		</Card>
	);
}

type CreateProfileFormProps = {
	onSuccess: (profile: Profile) => void;
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
			const newProfile = await createProfile({
				name: name().trim(),
				slug: slug().trim(),
				description: description().trim() || undefined,
			});
			props.onSuccess(newProfile);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create profile");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Card>
			<form onSubmit={handleSubmit}>
				<CardHeader>
					<CardTitle>Create New Profile</CardTitle>
				</CardHeader>

				<CardContent class="flex-col" style={{ gap: "12px" }}>
					<FormField label="Name" id="create-profile-name">
						<Input id="create-profile-name" value={name()} onInput={e => handleNameChange(e.currentTarget.value)} placeholder="My Public Timeline" />
					</FormField>

					<FormField label="Slug (URL path)" id="create-profile-slug">
						<Input id="create-profile-slug" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
					</FormField>

					<FormField label="Description (optional)" id="create-profile-description">
						<Input id="create-profile-description" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
					</FormField>

					<Show when={error()}>
						<p class="error-icon text-sm">{error()}</p>
					</Show>
				</CardContent>

				<CardFooter class="flex-row" style={{ gap: "8px", "justify-content": "flex-end" }}>
					<Button variant="secondary" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" loading={submitting()}>
						Create Profile
					</Button>
				</CardFooter>
			</form>
		</Card>
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
		<Card>
			<form onSubmit={handleSubmit}>
				<CardHeader>
					<CardTitle>Edit Profile</CardTitle>
				</CardHeader>

				<CardContent class="flex-col" style={{ gap: "12px" }}>
					<FormField label="Name" id="edit-profile-name">
						<Input id="edit-profile-name" value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="My Public Timeline" />
					</FormField>

					<FormField label="Slug (URL path)" id="edit-profile-slug">
						<Input id="edit-profile-slug" value={slug()} onInput={e => setSlug(e.currentTarget.value)} placeholder="my-public-timeline" />
					</FormField>

					<FormField label="Description (optional)" id="edit-profile-description">
						<Input id="edit-profile-description" value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description" />
					</FormField>

					<Show when={error()}>
						<p class="error-icon text-sm">{error()}</p>
					</Show>
				</CardContent>

				<CardFooter class="flex-row" style={{ gap: "8px", "justify-content": "flex-end" }}>
					<Button variant="secondary" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" loading={submitting()}>
						Save Changes
					</Button>
				</CardFooter>
			</form>
		</Card>
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
