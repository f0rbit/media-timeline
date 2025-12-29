import { For } from "solid-js";
import type { PlatformCount } from "@/utils/analytics";
import PlatformIcon from "../PlatformIcon";

type PlatformDistributionProps = {
	platforms: PlatformCount[];
};

export default function PlatformDistribution(props: PlatformDistributionProps) {
	return (
		<div class="distribution-list">
			<For each={props.platforms}>
				{platform => (
					<div class="distribution-row">
						<div class="distribution-label">
							<PlatformIcon platform={platform.platform} size={16} />
							<span>{platform.platform}</span>
						</div>
						<div class="distribution-bar-track">
							<div class="distribution-bar-fill" style={{ width: `${platform.percentage}%` }} />
						</div>
						<span class="distribution-count">{platform.count}</span>
					</div>
				)}
			</For>
		</div>
	);
}
