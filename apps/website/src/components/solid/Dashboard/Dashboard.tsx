import { type DashboardStats as Stats, calculateActivityByWeek, calculateContentTypes, calculateDashboardStats, calculatePlatformDistribution, getItemsForDate, getRecentItems } from "@/utils/analytics";
import { type ApiResult, type ProfileTimelineResponse, initMockAuth, profiles } from "@/utils/api";
import { Show, createSignal } from "solid-js";
import { createResource } from "solid-js";
import ActivityChart, { ActivityPreview } from "./ActivityChart";
import ContentTypeList from "./ContentTypeList";
import DashboardStats from "./DashboardStats";
import PlatformDistribution from "./PlatformDistribution";
import RecentActivity from "./RecentActivity";

type DashboardProps = {
	profileSlug?: string | null;
	initialTimeline?: ProfileTimelineResponse | null;
};

export default function Dashboard(props: DashboardProps) {
	initMockAuth();

	// Check if SSR provided data (even if empty - that's valid SSR data)
	const hasSSRData = props.initialTimeline !== undefined;

	const [fetchTrigger, setFetchTrigger] = createSignal(0);

	const [data] = createResource(
		() => {
			const trigger = fetchTrigger();
			const slug = props.profileSlug;

			// Skip initial fetch if we have SSR data (even empty means SSR succeeded)
			if (trigger === 0 && hasSSRData) {
				return null;
			}

			return slug;
		},
		async (slug): Promise<ProfileTimelineResponse | null> => {
			if (!slug) return null;
			const result: ApiResult<ProfileTimelineResponse> = await profiles.getTimeline(slug);
			if (!result.ok) throw new Error(result.error.message);
			return result.value;
		},
		{
			initialValue: props.initialTimeline ?? undefined,
		}
	);

	return (
		<div class="dashboard">
			<Show when={!props.profileSlug}>
				<div class="empty-state">
					<h3>No profile selected</h3>
					<p class="muted">Select a profile from the dropdown above to view your dashboard.</p>
					<a href="/connections" class="oauth-button">
						Manage Profiles
					</a>
				</div>
			</Show>

			<Show when={props.profileSlug}>
				<Show when={data.loading}>
					<p class="tertiary">Loading dashboard...</p>
				</Show>

				<Show when={data.error}>
					<p class="error-icon">Failed to load dashboard: {data.error.message}</p>
				</Show>

				<Show when={data()} keyed>
					{response => <DashboardContent response={response} />}
				</Show>
			</Show>
		</div>
	);
}

type DashboardContentProps = {
	response: ProfileTimelineResponse;
};

function DashboardContent(props: DashboardContentProps) {
	const [selectedDate, setSelectedDate] = createSignal<string | null>(null);

	const groups = () => props.response.data.groups;
	const stats = (): Stats => calculateDashboardStats(groups());
	const platforms = () => calculatePlatformDistribution(groups());
	const activity = () => calculateActivityByWeek(groups(), 52);
	const maxActivityCount = () => {
		let max = 0;
		for (const week of activity()) {
			for (const day of week.days) {
				if (day.count > max) max = day.count;
			}
		}
		return max;
	};
	const contentTypes = () => calculateContentTypes(groups());
	const recentItems = () => getRecentItems(groups(), 5);
	const selectedDateItems = () => {
		const date = selectedDate();
		if (!date) return [];
		return getItemsForDate(groups(), date);
	};

	const handleDateSelect = (date: string) => {
		// Toggle selection
		if (selectedDate() === date) {
			setSelectedDate(null);
		} else {
			setSelectedDate(date);
		}
	};

	return (
		<>
			<Show when={stats().totalEntries === 0}>
				<div class="empty-state">
					<h3>No activity data yet</h3>
					<p class="muted">Your dashboard will show analytics once you connect platforms and run a sync.</p>
					<a href="/connections" class="oauth-button">
						Connect Platforms
					</a>
					<p class="text-sm muted" style={{ "margin-top": "1rem" }}>
						Data syncs automatically every 5 minutes.
					</p>
				</div>
			</Show>

			<Show when={stats().totalEntries > 0}>
				<section class="dashboard-section">
					<DashboardStats stats={stats()} />
				</section>

				<Show when={activity().length > 0}>
					<section class="dashboard-section" style={{ display: "flex", "align-items": "center" }}>
						<h3>Activity</h3>
						<ActivityChart activity={activity()} onSelectDate={handleDateSelect} selectedDate={selectedDate()} maxCount={maxActivityCount()} />
						<Show when={selectedDate()} keyed>
							{date => <ActivityPreview date={date} items={selectedDateItems()} />}
						</Show>
					</section>
				</Show>

				<Show when={platforms().length > 0}>
					<section class="dashboard-section">
						<h3>Platforms</h3>
						<PlatformDistribution platforms={platforms()} />
					</section>
				</Show>

				<Show when={contentTypes().length > 0 || recentItems().length > 0}>
					<div class="dashboard-two-column">
						<Show when={contentTypes().length > 0}>
							<section class="dashboard-section">
								<h3>Content Types</h3>
								<ContentTypeList types={contentTypes()} />
							</section>
						</Show>

						<Show when={recentItems().length > 0}>
							<section class="dashboard-section">
								<h3>Recent Activity</h3>
								<RecentActivity items={recentItems()} />
							</section>
						</Show>
					</div>
				</Show>
			</Show>
		</>
	);
}
