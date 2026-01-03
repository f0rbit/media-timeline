import { connections } from "@/utils/api";
import { createSignal } from "solid-js";

type Props = {
	accountId: string;
	settings: { hidden_projects?: string[]; all_projects?: boolean } | null;
	onUpdate: () => void;
};

export default function DevpadSettings(props: Props) {
	const [updating, setUpdating] = createSignal(false);

	const allProjects = () => props.settings?.all_projects ?? true;

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
			<h6 class="settings-title tertiary text-sm font-medium">Project Filters</h6>
			<div class="filter-toggles">
				<label class="filter-toggle">
					<input type="checkbox" checked={allProjects()} onChange={e => updateSetting("all_projects", e.currentTarget.checked)} disabled={updating()} />
					<span class="secondary text-sm">Include all projects</span>
				</label>
			</div>
			<p class="muted text-xs">Project-level filtering coming soon.</p>
		</div>
	);
}
