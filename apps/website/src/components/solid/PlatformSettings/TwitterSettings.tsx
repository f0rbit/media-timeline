import { connections } from "@/utils/api-client";
import { Show, createSignal } from "solid-js";

type Props = {
	accountId: string;
	settings: {
		include_retweets?: boolean;
		include_replies?: boolean;
		hide_sensitive?: boolean;
	} | null;
	onUpdate: () => void;
};

export default function TwitterSettings(props: Props) {
	const [expanded, setExpanded] = createSignal(false);
	const [saving, setSaving] = createSignal(false);

	const includeRetweets = () => props.settings?.include_retweets ?? true;
	const includeReplies = () => props.settings?.include_replies ?? false;
	const hideSensitive = () => props.settings?.hide_sensitive ?? false;

	const updateSetting = async (key: string, value: boolean) => {
		setSaving(true);
		await connections.updateSettings(props.accountId, { [key]: value });
		setSaving(false);
		props.onUpdate();
	};

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
							<input type="checkbox" checked={includeRetweets()} onChange={() => updateSetting("include_retweets", !includeRetweets())} disabled={saving()} />
							<span class="text-sm">Include retweets in timeline</span>
						</label>
						<label class="filter-toggle">
							<input type="checkbox" checked={includeReplies()} onChange={() => updateSetting("include_replies", !includeReplies())} disabled={saving()} />
							<span class="text-sm">Include replies in timeline</span>
						</label>
						<label class="filter-toggle">
							<input type="checkbox" checked={hideSensitive()} onChange={() => updateSetting("hide_sensitive", !hideSensitive())} disabled={saving()} />
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

function ChevronIcon(props: { expanded: boolean }) {
	return (
		<svg
			class={`chevron-icon ${props.expanded ? "expanded" : ""}`}
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}
