import { Stepper, Step } from "@f0rbit/ui";
import Link from "lucide-solid/icons/link";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import LayoutList from "lucide-solid/icons/layout-list";

export default function HowItWorks() {
	return (
		<section class="how-it-works-section">
			<h2>How it works</h2>
			<Stepper orientation="horizontal">
				<Step title="Connect" description="Link your accounts with secure OAuth or API tokens." icon={<Link size={16} />} status="completed" />
				<Step title="Sync" description="Background sync runs every 5 minutes. Always up to date." icon={<RefreshCw size={16} />} status="completed" />
				<Step title="Browse" description="Your unified timeline, organized and searchable." icon={<LayoutList size={16} />} status="completed" />
			</Stepper>
		</section>
	);
}
