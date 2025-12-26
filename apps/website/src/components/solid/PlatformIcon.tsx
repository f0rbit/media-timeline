type Props = {
	platform: string;
	size?: number;
};

export default function PlatformIcon(props: Props) {
	const size = props.size ?? 18;

	switch (props.platform) {
		case "github":
			return <GithubIcon size={size} />;
		case "bluesky":
			return <BlueskyIcon size={size} />;
		case "youtube":
			return <YoutubeIcon size={size} />;
		case "devpad":
			return <DevpadIcon size={size} />;
		default:
			return <DefaultIcon size={size} />;
	}
}

function GithubIcon(props: { size: number }) {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
			<path d="M9 18c-4.51 2-5-2-7-2" />
		</svg>
	);
}

function BlueskyIcon(props: { size: number }) {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2 9a7 7 0 0 0 7 7h1a7 7 0 0 0 7-7 7 7 0 0 0-7-7h-1a7 7 0 0 0-7 7z" />
			<path d="M22 9a3 3 0 0 0-3-3h-1" />
			<path d="M18 16a3 3 0 0 0 3-3" />
		</svg>
	);
}

function YoutubeIcon(props: { size: number }) {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
			<path d="m10 15 5-3-5-3z" />
		</svg>
	);
}

function DevpadIcon(props: { size: number }) {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="M7 9h4" />
			<path d="M7 13h10" />
			<path d="M7 17h6" />
		</svg>
	);
}

function DefaultIcon(props: { size: number }) {
	return (
		<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="10" />
			<path d="M12 16v-4" />
			<path d="M12 8h.01" />
		</svg>
	);
}
