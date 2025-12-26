import { createSignal, Show } from "solid-js";

type Props = {
	data: unknown;
	title?: string;
};

export default function RawDataViewer(props: Props) {
	const [collapsed, setCollapsed] = createSignal(false);
	const [copied, setCopied] = createSignal(false);

	const formattedJson = () => JSON.stringify(props.data, null, 2);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(formattedJson());
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div class="raw-viewer">
			<div class="flex-row justify-between" style={{ "margin-bottom": "8px" }}>
				<Show when={props.title}>
					<span class="tertiary text-sm">{props.title}</span>
				</Show>
				<div class="flex-row">
					<button class="icon-btn" onClick={() => setCollapsed(!collapsed())}>
						{collapsed() ? "Expand" : "Collapse"}
					</button>
					<button class="icon-btn" onClick={handleCopy}>
						{copied() ? "Copied!" : "Copy"}
					</button>
				</div>
			</div>
			<Show when={!collapsed()}>
				<pre>
					<code>{formattedJson()}</code>
				</pre>
			</Show>
		</div>
	);
}
