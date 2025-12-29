type Props = { expanded: boolean };

export default function ChevronIcon(props: Props) {
	return (
		<svg
			class={`chevron-icon ${props.expanded ? "expanded" : ""}`}
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}
