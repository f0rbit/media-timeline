import { Checkbox } from "@f0rbit/ui";
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
				<Checkbox checked={allProjects()} onChange={() => updateSetting("all_projects", !allProjects())} label="Include all projects" disabled={updating()} />
			</div>
			<p class="muted text-xs">Project-level filtering coming soon.</p>
		</div>
	);
}
