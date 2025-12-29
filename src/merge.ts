/**
 * Generic merge function for arrays with unique keys.
 * Returns merged array and count of new items.
 */
export const mergeByKey = <T>(existing: T[] | null | undefined, incoming: T[], getKey: (item: T) => string): { merged: T[]; newCount: number } => {
	if (!existing || existing.length === 0) {
		return { merged: incoming, newCount: incoming.length };
	}

	const existingKeys = new Set(existing.map(getKey));
	const newItems = incoming.filter(item => !existingKeys.has(getKey(item)));

	return {
		merged: [...existing, ...newItems],
		newCount: newItems.length,
	};
};
