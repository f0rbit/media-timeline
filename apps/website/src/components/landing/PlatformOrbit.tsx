import { For } from "solid-js";
import PlatformIcon from "../solid/PlatformIcon";

type Platform = "github" | "reddit" | "twitter" | "bluesky" | "youtube" | "devpad";

const PLATFORMS: Platform[] = ["github", "reddit", "twitter", "bluesky", "youtube", "devpad"];

export default function PlatformOrbit() {
	return (
		<div class="orbit-container">
			<For each={PLATFORMS}>
				{platform => (
					<div class={`orbit-icon platform-${platform}`}>
						<PlatformIcon platform={platform} size={24} />
					</div>
				)}
			</For>
		</div>
	);
}
