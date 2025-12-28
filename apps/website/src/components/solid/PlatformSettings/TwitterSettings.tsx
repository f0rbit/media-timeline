import { Show } from "solid-js";
import ChevronIcon from "../ChevronIcon";
import { useSettings } from "./useSettings";

type TwitterSettingsData = {
	include_retweets?: boolean;
	include_replies?: boolean;
	hide_sensitive?: boolean;
};

type Props = {
	accountId: string;
	settings: TwitterSettingsData | null;
	onUpdate: () => void;
};

export default function TwitterSettings(props: Props) {
	const { updating, expanded, setExpanded, updateSetting } = useSettings(props.accountId, props.onUpdate);

	const includeRetweets = () => props.settings?.include_retweets ?? true;
	const includeReplies = () => props.settings?.include_replies ?? false;
	const hideSensitive = () => props.settings?.hide_sensitive ?? false;

	const toggle = (key: keyof TwitterSettingsData, current: boolean) => updateSetting<TwitterSettingsData>(key, !current, props.settings);

	const toggleExpanded = () => setExpanded(!expanded());

	return (
		<div class="settings-section">
			<button type="button" class="settings-header" onClick={toggleExpanded}>
				<ChevronIcon expanded={expanded()} />
				<h6 class="settings-title tertiary text-sm font-medium">Twitter/X Settings</h6>
			</button>

			<Show when={expanded()}>
				<div class="settings-content">
					<div class="filter-toggles">
						<label class="filter-toggle">
							<input type="checkbox" checked={includeRetweets()} onChange={() => toggle("include_retweets", includeRetweets())} disabled={updating()} />
							<span class="text-sm">Include retweets in timeline</span>
						</label>
						<label class="filter-toggle">
							<input type="checkbox" checked={includeReplies()} onChange={() => toggle("include_replies", includeReplies())} disabled={updating()} />
							<span class="text-sm">Include replies in timeline</span>
						</label>
						<label class="filter-toggle">
							<input type="checkbox" checked={hideSensitive()} onChange={() => toggle("hide_sensitive", hideSensitive())} disabled={updating()} />
							<span class="text-sm">Hide sensitive content</span>
						</label>
					</div>
					<p class="muted text-xs" style={{ "margin-top": "8px" }}>
						Note: Changes apply on next data refresh.
					</p>
				</div>
			</Show>
		</div>
	);
}
