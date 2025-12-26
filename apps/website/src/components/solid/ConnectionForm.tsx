import { createSignal, For, Show } from "solid-js";
import { connections, initMockAuth } from "@/utils/api-client";
import { formatPlatformName } from "@/utils/formatters";
import PlatformIcon from "./PlatformIcon";

const PLATFORMS = ["github", "bluesky", "youtube", "devpad"] as const;
type Platform = (typeof PLATFORMS)[number];

type Props = {
	onSuccess?: () => void;
};

export default function ConnectionForm(props: Props) {
	initMockAuth();

	const [platform, setPlatform] = createSignal<Platform>("github");
	const [accessToken, setAccessToken] = createSignal("");
	const [username, setUsername] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [success, setSuccess] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		setSuccess(false);

		const result = await connections.create({
			platform: platform(),
			access_token: accessToken(),
			platform_username: username() || undefined,
		});

		if (result.ok === false) {
			setError(result.error.message);
			setSubmitting(false);
			return;
		}

		setSuccess(true);
		setAccessToken("");
		setUsername("");
		setSubmitting(false);

		if (props.onSuccess) {
			props.onSuccess();
		}
	};

	const getPlaceholder = (p: Platform): string => {
		const placeholders: Record<Platform, string> = {
			github: "ghp_xxxxxxxxxxxxxxxxxxxx",
			bluesky: "App password from settings",
			youtube: "YouTube API key",
			devpad: "Devpad API token",
		};
		return placeholders[p];
	};

	const getUsernameLabel = (p: Platform): string => {
		const labels: Record<Platform, string> = {
			github: "GitHub username",
			bluesky: "Handle (e.g., user.bsky.social)",
			youtube: "Channel ID",
			devpad: "Username",
		};
		return labels[p];
	};

	return (
		<form onSubmit={handleSubmit} class="flex-col">
			<section>
				<label>Platform</label>
				<div class="flex-row" style={{ gap: "8px", "flex-wrap": "wrap" }}>
					<For each={PLATFORMS}>
						{p => (
							<button
								type="button"
								class={`flex-row ${platform() === p ? "active" : ""}`}
								style={{
									padding: "8px 12px",
									cursor: "pointer",
									background: "none",
									border: platform() === p ? "1px solid var(--text-link)" : "1px solid var(--input-border)",
									"border-radius": "4px",
								}}
								onClick={() => setPlatform(p)}
							>
								<PlatformIcon platform={p} />
								<span>{formatPlatformName(p)}</span>
							</button>
						)}
					</For>
				</div>
			</section>

			<section>
				<label>{getUsernameLabel(platform())} (optional)</label>
				<input type="text" value={username()} onInput={e => setUsername(e.currentTarget.value)} placeholder={getUsernameLabel(platform())} />
			</section>

			<section>
				<label>Access Token</label>
				<input type="password" value={accessToken()} onInput={e => setAccessToken(e.currentTarget.value)} placeholder={getPlaceholder(platform())} required />
				<small class="description">Your token is encrypted before being stored.</small>
			</section>

			<Show when={error()}>
				<p class="error-icon">{error()}</p>
			</Show>

			<Show when={success()}>
				<p class="success-icon">Connection added successfully!</p>
			</Show>

			<button type="submit" disabled={submitting() || !accessToken()}>
				{submitting() ? "Adding..." : "Add Connection"}
			</button>
		</form>
	);
}
