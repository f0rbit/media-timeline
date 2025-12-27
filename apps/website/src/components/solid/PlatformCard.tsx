import { Match, Show, Switch } from "solid-js";
import type { ConnectionWithSettings, PlatformSettings } from "@/utils/api-client";
import { formatPlatformName, formatRelativeTime } from "@/utils/formatters";
import StatusBadge, { type ConnectionState } from "./StatusBadge";
import PlatformIcon from "./PlatformIcon";
import PlatformSetupForm, { type Platform } from "./PlatformSetupForm";
import ConnectionActions from "./ConnectionActions";
import GitHubSettings from "./PlatformSettings/GitHubSettings";
import BlueskySettings from "./PlatformSettings/BlueskySettings";
import YouTubeSettings from "./PlatformSettings/YouTubeSettings";
import DevpadSettings from "./PlatformSettings/DevpadSettings";
import RedditSettings from "./PlatformSettings/RedditSettings";

type Props = {
	platform: Platform;
	connection: ConnectionWithSettings | null;
	onConnectionChange: () => void;
};

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
					<div class="flex-row">
						<h6 class="secondary font-medium">{formatPlatformName(props.platform)}</h6>
						<Show when={props.connection}>
							<span class="tertiary text-sm">{"·"}</span>
							<span class="tertiary text-sm">
								{props.connection!.platform_username ?? "Connected"}
								<Show when={state() === "inactive"}> · Paused</Show>
								<Show when={state() === "active" && props.connection!.last_fetched_at}> · Last synced: {formatRelativeTime(props.connection!.last_fetched_at!)}</Show>
							</span>
						</Show>
					</div>
				</div>
				<div class="flex-row items-center" style={{ gap: "8px" }}>
					<StatusBadge state={state()} />
					<Show when={props.connection}>
						<ConnectionActions accountId={props.connection!.account_id} isActive={props.connection!.is_active} state={state() as "active" | "inactive"} onAction={props.onConnectionChange} />
					</Show>
				</div>
			</div>

			<Switch>
				<Match when={state() === "not_configured"}>
					<PlatformSetupForm platform={props.platform} onSuccess={props.onConnectionChange} />
				</Match>
				<Match when={state() === "active"}>
					<div class="platform-settings">
						<Switch>
							<Match when={props.platform === "github"}>
								<GitHubSettings accountId={props.connection!.account_id} settings={props.connection?.settings as { hidden_repos?: string[] } | null} onUpdate={props.onConnectionChange} />
							</Match>
							<Match when={props.platform === "bluesky"}>
								<BlueskySettings accountId={props.connection!.account_id} settings={props.connection?.settings as { include_replies?: boolean; include_reposts?: boolean } | null} onUpdate={props.onConnectionChange} />
							</Match>
							<Match when={props.platform === "youtube"}>
								<YouTubeSettings
									accountId={props.connection!.account_id}
									settings={props.connection?.settings as { include_watch_history?: boolean; include_liked?: boolean; channel_name?: string } | null}
									onUpdate={props.onConnectionChange}
								/>
							</Match>
							<Match when={props.platform === "devpad"}>
								<DevpadSettings accountId={props.connection!.account_id} settings={props.connection?.settings as { hidden_projects?: string[]; all_projects?: boolean } | null} onUpdate={props.onConnectionChange} />
							</Match>
							<Match when={props.platform === "reddit"}>
								<RedditSettings
									accountId={props.connection!.account_id}
									settings={props.connection?.settings as { include_posts?: boolean; include_comments?: boolean; hidden_subreddits?: string[] } | null}
									onUpdate={props.onConnectionChange}
								/>
							</Match>
						</Switch>
					</div>
				</Match>
			</Switch>
		</div>
	);
}
