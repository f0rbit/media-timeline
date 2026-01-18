import { Show, createSignal } from "solid-js";
import { Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, Button, FormField, Input, Textarea } from "@f0rbit/ui";

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
				const data = (await res.json()) as { error?: string; message?: string };
				throw new Error(data.error || data.message || "Failed to save");
			}

			const saved = (await res.json()) as Profile;
			props.onSave(saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal open={true} onClose={props.onClose}>
			<ModalHeader>
				<ModalTitle>{isEditMode() ? "Edit Profile" : "Create Profile"}</ModalTitle>
			</ModalHeader>

			<ModalBody>
				<form onSubmit={handleSubmit} class="stack gap-md">
					<FormField label="Name" required>
						<Input value={name()} onInput={e => setName(e.currentTarget.value)} placeholder="My Profile" maxLength={100} />
					</FormField>

					<FormField label="Slug" required error={slugError() ?? undefined} description={slugError() ? undefined : "lowercase letters, numbers, and hyphens only"}>
						<Input value={slug()} onInput={e => handleSlugInput(e.currentTarget.value)} placeholder="my-profile" maxLength={50} error={!!slugError()} />
					</FormField>

					<FormField label="Description">
						<Textarea value={description()} onInput={e => setDescription(e.currentTarget.value)} placeholder="A brief description of this profile..." rows={3} maxLength={500} />
					</FormField>

					<Show when={error()}>
						<div class="form-error">{error()}</div>
					</Show>
				</form>
			</ModalBody>

			<ModalFooter>
				<Button variant="secondary" onClick={props.onClose} disabled={saving()}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} disabled={!canSubmit()}>
					{saving() ? "Saving..." : isEditMode() ? "Save Changes" : "Create Profile"}
				</Button>
			</ModalFooter>
		</Modal>
	);
}
