import { parseISO } from "date-fns";
import type { TimelineItem } from "./types";

const compareTimestampDesc = (a: TimelineItem, b: TimelineItem): number => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime();

export const combineTimelines = (items: TimelineItem[]): TimelineItem[] => [...items].sort(compareTimestampDesc);
