import { Show, createSignal } from "solid-js";

export type Profile = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	created_at: string;
	updated_at: string;
};

type ProfileEditorProps = {
	profile?: Profile;
	onSave: (profile: Profile) => void;
	onClose: () => void;
};

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const formatSlug = (value: string): string =>
	value
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-");

const validateSlug = (value: string): string | null => {
	if (value.length < 3) return "Slug must be at least 3 characters";
	if (value.length > 50) return "Slug must be at most 50 characters";
	if (!SLUG_REGEX.test(value)) return "Invalid format";
	return null;
};

export default function ProfileEditor(props: ProfileEditorProps) {
	const [name, setName] = createSignal(props.profile?.name ?? "");
	const [slug, setSlug] = createSignal(props.profile?.slug ?? "");
	const [description, setDescription] = createSignal(props.profile?.description ?? "");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	const isEditMode = () => !!props.profile;
	const slugError = () => (slug().length > 0 ? validateSlug(slug()) : null);
	const canSubmit = () => name().trim().length > 0 && slug().length >= 3 && !slugError() && !saving();

	const handleSlugInput = (value: string) => {
		setSlug(formatSlug(value));
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setSaving(true);
		setError(null);

		try {
			const url = isEditMode() ? `/api/v1/profiles/${props.profile?.id}` : "/api/v1/profiles";
			const method = isEditMode() ? "PATCH" : "POST";

			const res = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: name().trim(),
					slug: slug(),
					description: description().trim() || null,
				}),
				credentials: "include",
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || data.message || "Failed to save");
			}

			const saved = await res.json();
			props.onSave(saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setSaving(false);
		}
	};

	const handleOverlayClick = (e: MouseEvent) => {
		if (e.target === e.currentTarget) props.onClose();
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") props.onClose();
	};

	return (
		<div class="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
			<div class="modal-card">
				<div class="modal-header">
					<h3>{isEditMode() ? "Edit Profile" : "Create Profile"}</h3>
					<button class="modal-close" onClick={props.onClose} type="button" aria-label="Close">
						<CloseIcon />
					</button>
				</div>

				<form onSubmit={handleSubmit} class="modal-form">
					<div class="form-row">
						<label class="tertiary text-sm">
							Name <span class="required">*</span>
						</label>
						<input type="text" value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="My Profile" required maxLength={100} />
					</div>

					<div class="form-row">
						<label class="tertiary text-sm">
							Slug <span class="required">*</span>
						</label>
						<input type="text" value={slug()} onInput={e => handleSlugInput(e.currentTarget.value)} placeholder="my-profile" required maxLength={50} class={slugError() ? "input-error" : ""} />
						<Show when={slugError()} fallback={<small class="muted text-xs">lowercase letters, numbers, and hyphens only</small>}>
							<small class="error-text text-xs">{slugError()}</small>
						</Show>
					</div>

					<div class="form-row">
						<label class="tertiary text-sm">Description</label>
						<textarea value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description of this profile..." rows={3} maxLength={500} />
					</div>

					<Show when={error()}>
						<div class="form-error">
							<span class="error-icon text-sm">{error()}</span>
						</div>
					</Show>

					<div class="modal-actions">
						<button type="button" class="btn-secondary" onClick={props.onClose} disabled={saving()}>
							Cancel
						</button>
						<button type="submit" disabled={!canSubmit()}>
							{saving() ? "Saving..." : isEditMode() ? "Save Changes" : "Create Profile"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

function CloseIcon() {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}
