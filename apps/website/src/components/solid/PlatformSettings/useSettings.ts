import { connections } from "@/utils/api-client";
import { createSignal } from "solid-js";

export function useSettings(accountId: string, onUpdate?: () => void) {
	const [updating, setUpdating] = createSignal(false);
	const [expanded, setExpanded] = createSignal(false);

	const updateSetting = async <T extends Record<string, unknown>>(key: keyof T, value: T[keyof T], currentSettings: T | null) => {
		setUpdating(true);
		try {
			await connections.updateSettings(accountId, {
				...currentSettings,
				[key]: value,
			});
			onUpdate?.();
		} finally {
			setUpdating(false);
		}
	};

	return { updating, expanded, setExpanded, updateSetting };
}
