import { createSignal } from "solid-js";
import { connections } from "@/utils/api-client";

type Props = {
	accountId: string;
	settings: { include_replies?: boolean; include_reposts?: boolean } | null;
	onUpdate: () => void;
};

export default function BlueskySettings(props: Props) {
	const [updating, setUpdating] = createSignal(false);

	const includeReplies = () => props.settings?.include_replies ?? true;
	const includeReposts = () => props.settings?.include_reposts ?? false;

	const updateSetting = async (key: string, value: boolean) => {
		setUpdating(true);
		await connections.updateSettings(props.accountId, {
			...props.settings,
			[key]: value,
		});
		setUpdating(false);
		props.onUpdate();
	};

	return (
		<div class="settings-section">
			<h6 class="settings-title tertiary text-sm font-medium">Content Filters</h6>
			<div class="filter-toggles">
				<label class="filter-toggle">
					<input type="checkbox" checked={true} disabled />
					<span class="secondary text-sm">Include my posts</span>
				</label>
				<label class="filter-toggle">
					<input type="checkbox" checked={includeReplies()} onChange={e => updateSetting("include_replies", e.currentTarget.checked)} disabled={updating()} />
					<span class="secondary text-sm">Include replies</span>
				</label>
				<label class="filter-toggle">
					<input type="checkbox" checked={includeReposts()} onChange={e => updateSetting("include_reposts", e.currentTarget.checked)} disabled={updating()} />
					<span class="secondary text-sm">Include reposts</span>
				</label>
			</div>
		</div>
	);
}
