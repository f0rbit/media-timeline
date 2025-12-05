import type { TimelineItem } from "./types";

const compareTimestampDesc = (a: TimelineItem, b: TimelineItem): number => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

export const combineTimelines = (items: TimelineItem[]): TimelineItem[] => [...items].sort(compareTimestampDesc);
