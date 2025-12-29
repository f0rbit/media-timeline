import type { ConnectionWithSettings } from "@/utils/api-client";
import { getApiKey } from "@/utils/api-client";
import { formatPlatformName, formatRelativeTime } from "@/utils/formatters";
import { Match, Show, Switch } from "solid-js";
import ConnectionActions from "./ConnectionActions";
import PlatformIcon from "./PlatformIcon";
import BlueskySettings from "./PlatformSettings/BlueskySettings";
import DevpadSettings from "./PlatformSettings/DevpadSettings";
import GitHubSettings from "./PlatformSettings/GitHubSettings";
import RedditSettings from "./PlatformSettings/RedditSettings";
import TwitterSettings from "./PlatformSettings/TwitterSettings";
import YouTubeSettings from "./PlatformSettings/YouTubeSettings";
import PlatformSetupForm, { type Platform } from "./PlatformSetupForm";
import StatusBadge, { type ConnectionState } from "./StatusBadge";

type Props = {
	platform: Platform;
	profileId: string;
	connection: ConnectionWithSettings | null;
	onConnectionChange: () => void;
};

function RedditOAuthButton(props: { profileId: string }) {
	const apiUrl = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

	const handleConnect = () => {
		const apiKey = getApiKey();
		if (!apiKey) {
			console.error("No API key available for Reddit OAuth");
			return;
		}
		window.location.href = `${apiUrl}/api/auth/reddit?key=${encodeURIComponent(apiKey)}&profile_id=${encodeURIComponent(props.profileId)}`;
	};

	return (
		<div class="oauth-setup">
			<p class="muted text-sm">Connect your Reddit account to sync your posts and comments.</p>
			<button type="button" onClick={handleConnect} class="oauth-button">
				Connect with Reddit
			</button>
		</div>
	);
}

function TwitterOAuthButton(props: { profileId: string }) {
	const apiUrl = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

	const handleConnect = () => {
		const apiKey = getApiKey();
		if (!apiKey) {
			console.error("No API key available for Twitter OAuth");
			return;
		}
		window.location.href = `${apiUrl}/api/auth/twitter?key=${encodeURIComponent(apiKey)}&profile_id=${encodeURIComponent(props.profileId)}`;
	};

	return (
		<div class="oauth-setup">
			<p class="muted text-sm">Connect your Twitter/X account to sync your tweets.</p>
			<button type="button" onClick={handleConnect} class="oauth-button">
				Connect with Twitter/X
			</button>
		</div>
	);
}

function GitHubOAuthButton(props: { profileId: string }) {
	const apiUrl = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

	const handleConnect = () => {
		const apiKey = getApiKey();
		if (!apiKey) {
			console.error("No API key available for GitHub OAuth");
			return;
		}
		window.location.href = `${apiUrl}/api/auth/github?key=${encodeURIComponent(apiKey)}&profile_id=${encodeURIComponent(props.profileId)}`;
	};

	return (
		<div class="oauth-setup">
			<p class="muted text-sm">Connect your GitHub account to sync your commits and pull requests.</p>
			<button type="button" onClick={handleConnect} class="oauth-button">
				Connect with GitHub
			</button>
		</div>
	);
}

type ActiveConnectionSettingsProps = {
	platform: Platform;
	connection: ConnectionWithSettings;
	onUpdate: () => void;
};

function ActiveConnectionSettings(props: ActiveConnectionSettingsProps) {
	return (
		<Switch>
			<Match when={props.platform === "github"}>
				<GitHubSettings accountId={props.connection.account_id} settings={props.connection.settings as { hidden_repos?: string[] } | null} onUpdate={props.onUpdate} />
			</Match>
			<Match when={props.platform === "bluesky"}>
				<BlueskySettings accountId={props.connection.account_id} settings={props.connection.settings as { include_replies?: boolean; include_reposts?: boolean } | null} onUpdate={props.onUpdate} />
			</Match>
			<Match when={props.platform === "youtube"}>
				<YouTubeSettings accountId={props.connection.account_id} settings={props.connection.settings as { include_watch_history?: boolean; include_liked?: boolean; channel_name?: string } | null} onUpdate={props.onUpdate} />
			</Match>
			<Match when={props.platform === "devpad"}>
				<DevpadSettings accountId={props.connection.account_id} settings={props.connection.settings as { hidden_projects?: string[]; all_projects?: boolean } | null} onUpdate={props.onUpdate} />
			</Match>
			<Match when={props.platform === "reddit"}>
				<RedditSettings accountId={props.connection.account_id} settings={props.connection.settings as { include_posts?: boolean; include_comments?: boolean; hidden_subreddits?: string[] } | null} onUpdate={props.onUpdate} />
			</Match>
			<Match when={props.platform === "twitter"}>
				<TwitterSettings accountId={props.connection.account_id} settings={props.connection.settings as { include_retweets?: boolean; include_replies?: boolean; hide_sensitive?: boolean } | null} onUpdate={props.onUpdate} />
			</Match>
		</Switch>
	);
}

export default function PlatformCard(props: Props) {
	const state = (): ConnectionState => {
		if (!props.connection) return "not_configured";
		return props.connection.is_active ? "active" : "inactive";
	};

	const cardClass = () => {
		const base = `card platform-card platform-${props.platform}`;
		if (state() === "inactive") return `${base} card-inactive`;
		if (state() === "not_configured") return `${base} card-setup`;
		return base;
	};

	return (
		<div class={cardClass()}>
			<div class="flex-row justify-between">
				<div class="flex-row" style={{ gap: "12px" }}>
					<PlatformIcon platform={props.platform} size={24} />
					<div class="flex-row" style={{ "margin-bottom": state() === "inactive" ? "-0.15rem" : "" }}>
						<h6 class="secondary font-medium">{formatPlatformName(props.platform)}</h6>
						<Show when={props.connection} keyed>
							{connection => (
								<>
									<span class="tertiary text-sm">{"·"}</span>
									<span class="tertiary text-sm">
										{connection.platform_username ?? "Connected"}
										<Show when={state() === "inactive"}> · Paused</Show>
										<Show when={state() === "active" && connection.last_fetched_at} keyed>
											{lastFetched => <> · Last synced: {formatRelativeTime(lastFetched)}</>}
										</Show>
									</span>
								</>
							)}
						</Show>
					</div>
				</div>
				<div class="flex-row items-center" style={{ gap: "8px" }}>
					<StatusBadge state={state()} />
					<Show when={props.connection} keyed>
						{connection => <ConnectionActions accountId={connection.account_id} isActive={connection.is_active} state={state() as "active" | "inactive"} onAction={props.onConnectionChange} />}
					</Show>
				</div>
			</div>

			<Switch>
				<Match when={state() === "not_configured" && props.platform === "reddit"}>
					<RedditOAuthButton profileId={props.profileId} />
				</Match>
				<Match when={state() === "not_configured" && props.platform === "twitter"}>
					<TwitterOAuthButton profileId={props.profileId} />
				</Match>
				<Match when={state() === "not_configured" && props.platform === "github"}>
					<GitHubOAuthButton profileId={props.profileId} />
				</Match>
				<Match when={state() === "not_configured"}>
					<PlatformSetupForm platform={props.platform} profileId={props.profileId} onSuccess={props.onConnectionChange} />
				</Match>
				<Match when={state() === "active" && props.connection} keyed>
					{connection => (
						<div class="platform-settings">
							<ActiveConnectionSettings platform={props.platform} connection={connection} onUpdate={props.onConnectionChange} />
						</div>
					)}
				</Match>
			</Switch>
		</div>
	);
}
