import { connections } from "@/utils/api-client";
import { formatPlatformName } from "@/utils/formatters";
import { Show, createSignal } from "solid-js";

export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

type PlatformConfig = {
	tokenLabel: string;
	tokenPlaceholder: string;
	usernameLabel: string;
	usernamePlaceholder: string;
	helpText: string;
};

type Props = {
	platform: Platform;
	onSuccess: () => void;
};

type ManualSetupPlatform = "bluesky" | "youtube" | "devpad";

const PLATFORM_CONFIG: Record<ManualSetupPlatform, PlatformConfig> = {
	bluesky: {
		tokenLabel: "App Password",
		tokenPlaceholder: "xxxx-xxxx-xxxx-xxxx",
		usernameLabel: "Handle",
		usernamePlaceholder: "user.bsky.social",
		helpText: "Create an app password in Settings > App Passwords",
	},
	youtube: {
		tokenLabel: "API Key",
		tokenPlaceholder: "AIzaSy...",
		usernameLabel: "Channel ID",
		usernamePlaceholder: "UC...",
		helpText: "Get an API key from console.developers.google.com",
	},
	devpad: {
		tokenLabel: "API Token",
		tokenPlaceholder: "dp_...",
		usernameLabel: "Username",
		usernamePlaceholder: "your-username",
		helpText: "Generate a token in your Devpad settings",
	},
};

export default function PlatformSetupForm(props: Props) {
	const config = () => PLATFORM_CONFIG[props.platform as ManualSetupPlatform];

	const [token, setToken] = createSignal("");
	const [username, setUsername] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);

		const result = await connections.create({
			platform: props.platform,
			access_token: token(),
			platform_username: username() || undefined,
		});

		if (!result.ok) {
			setError(result.error.message);
			setSubmitting(false);
			return;
		}

		setSubmitting(false);
		props.onSuccess();
	};

	return (
		<form onSubmit={handleSubmit} class="setup-form">
			<div class="form-row">
				<label class="tertiary text-sm">{config().tokenLabel}</label>
				<input type="password" value={token()} onInput={e => setToken(e.currentTarget.value)} placeholder={config().tokenPlaceholder} required />
			</div>
			<div class="form-row">
				<label class="tertiary text-sm">{config().usernameLabel} (optional)</label>
				<input type="text" value={username()} onInput={e => setUsername(e.currentTarget.value)} placeholder={config().usernamePlaceholder} />
			</div>
			<small class="muted text-xs">{config().helpText}</small>
			<Show when={error()}>
				<p class="error-icon text-sm">{error()}</p>
			</Show>
			<button type="submit" disabled={submitting() || !token()}>
				{submitting() ? "Connecting..." : `Connect ${formatPlatformName(props.platform)}`}
			</button>
		</form>
	);
}
