import { createSignal, Show } from "solid-js";
import { api } from "@/utils/api";

type RedditCredentialsFormProps = {
	profileId: string;
	onSuccess: () => void;
	existingClientId?: string | null;
};

export default function RedditCredentialsForm(props: RedditCredentialsFormProps) {
	const [clientId, setClientId] = createSignal(props.existingClientId ?? "");
	const [clientSecret, setClientSecret] = createSignal("");
	const [error, setError] = createSignal<string | null>(null);
	const [submitting, setSubmitting] = createSignal(false);
	const [showHelp, setShowHelp] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError(null);

		if (!clientId().trim() || !clientSecret().trim()) {
			setError("Both Client ID and Client Secret are required");
			return;
		}

		setSubmitting(true);

		try {
			const result = await api.post<{ success: boolean; message?: string; error?: string }>(`/credentials/reddit`, {
				profile_id: props.profileId,
				client_id: clientId().trim(),
				client_secret: clientSecret().trim(),
			});

			if (result.ok) {
				props.onSuccess();
			} else {
				setError(result.error.message);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save credentials");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class="credentials-form">
			<div class="credentials-header">
				<p class="muted text-sm">Reddit requires you to create your own app for API access.</p>
				<button type="button" class="button-reset text-sm" style={{ color: "var(--text-link)", "text-decoration": "underline" }} onClick={() => setShowHelp(!showHelp())}>
					{showHelp() ? "Hide instructions" : "How to get credentials"}
				</button>
			</div>

			<Show when={showHelp()}>
				<div class="credentials-help">
					<ol class="text-sm muted" style={{ "padding-left": "1.25rem", margin: "0.5rem 0" }}>
						<li>
							Go to{" "}
							<a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer">
								reddit.com/prefs/apps
							</a>
						</li>
						<li>Click "create another app..." at the bottom</li>
						<li>Choose "script" as the app type</li>
						<li>
							Set redirect URI to: <code class="text-xs">https://media.devpad.tools/media/api/auth/reddit/callback</code>
						</li>
						<li>Copy the Client ID (under your app name) and Secret</li>
					</ol>
				</div>
			</Show>

			<form onSubmit={handleSubmit} class="flex-col" style={{ gap: "12px", "margin-top": "12px" }}>
				<div class="form-row">
					<label class="text-sm tertiary">Client ID</label>
					<input type="text" value={clientId()} onInput={e => setClientId(e.currentTarget.value)} placeholder="e.g., AbCdEfGhIjKlMn" disabled={submitting()} />
				</div>

				<div class="form-row">
					<label class="text-sm tertiary">Client Secret</label>
					<input type="password" value={clientSecret()} onInput={e => setClientSecret(e.currentTarget.value)} placeholder="Enter your client secret" disabled={submitting()} />
				</div>

				<Show when={error()}>
					<p class="error-icon text-sm">{error()}</p>
				</Show>

				<button type="submit" class="oauth-button" disabled={submitting()} style={{ "margin-top": "4px" }}>
					{submitting() ? "Saving..." : "Save Credentials"}
				</button>
			</form>
		</div>
	);
}
