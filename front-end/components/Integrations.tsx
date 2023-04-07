"use client";

import { useContext, useEffect, useState } from "react";
import { CustomerContext } from "./CustomerProvider";
import { IntegrationUpdateInput } from "types/types";
import { Client, Platform } from "@prisma/client";
import { FetchedCustomerData } from "api/users";
import { ChevronDown, ChevronUp, Github, Twitter } from "lucide-react";
import { Transition } from "react-transition-group";
import { IntegrationIcons, getPlatformIcon } from "@/components/IntegrationIcons";
import moment from "moment";

/** @todo fetch integration data from customer */
export default function Integrations() {
	return (
		<CustomerContext.Consumer>
			{({ data }) => (
				<section className="flex flex-col gap-2 items-center w-full pl-2 pr-6">
					<div className="flex flex-col gap-2 items-center w-full">
						<h2 className="font-semibold text-xl w-full h-10">Integrations</h2>

						{data.map((client, index) => (
							<IntegrationSection key={index} client={client} />
						))}
					</div>
				</section>
			)}
		</CustomerContext.Consumer>
	);
}

function IntegrationSection({ client }: { client: FetchedCustomerData }) {
	const [open, setOpen] = useState(false);

	const duration = 300;
	const defaultStyle = {
		transitionProperty: "max-height",
		transitionDuration: `${duration}ms`,
		maxHeight: 0,
		overflow: "hidden",
	};
	const transitionStyles: any = {
		entering: { transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)", maxHeight: "1000px" },
		entered: { transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)", maxHeight: "1000px" },
		exiting: { transitionTimingFunction: "cubic-bezier(0.4, 1.2, 0.5, 1)", maxHeight: 0 },
		exited: { transitionTimingFunction: "cubic-bezier(0.4, 1.2, 0.5, 1)", maxHeight: 0 },
	};

	return (
		<div className="bg-base-secondary rounded-xl p-2 border-2 border-base-border w-full">
			<div className="relative w-full flex items-center cursor-pointer hover:bg-base-tertiary rounded-xl py-1 px-4" onClick={() => setOpen(!open)}>
				<h2 className="font-semibold text-xl w-1/4">{client.name}</h2>
				<div className="w-1/2">
					<IntegrationIcons client={client} />
				</div>
				<div className="absolute right-4 top-[16%] flex justify-center items-center">{open ? <ChevronDown /> : <ChevronUp />}</div>
			</div>
			<Transition in={open} timeout={duration} unmountOnExit>
				{(state) => (
					<div style={{ ...defaultStyle, ...transitionStyles[state] }}>
						<IntegrationInterface client={client} />
					</div>
				)}
			</Transition>
		</div>
	);
}

function getIntegrationData(client: FetchedCustomerData): IntegrationUpdateInput {
	const DEFAULT_DATA = {
		username: "",
		enabled: false,
		total_posts: 0,
		last_fetched: null as Date | null,
	};
	const result = {
		client_id: client.id,
		reddit: {
			...DEFAULT_DATA,
		},
		twitter: {
			...DEFAULT_DATA,
		},
		github: {
			...DEFAULT_DATA,
			auth_token: "",
		},
	};

	if (!client) return result;
	if (!client.integrations || client.integrations.length == 0) return result;

	client.integrations.forEach((integration) => {
		if (!integration.data) return;
		const data = integration.data as any;

		switch (integration.platform) {
			case "REDDIT":
				result.reddit = data;
				result.reddit.enabled = integration.enabled;
				result.reddit.total_posts = integration.total_posts;
				result.reddit.last_fetched = integration.last_fetched;
				break;
			case "TWITTER":
				result.twitter = data;
				result.twitter.enabled = integration.enabled;
				result.twitter.total_posts = integration.total_posts;
				result.twitter.last_fetched = integration.last_fetched;
				break;
			case "GITHUB":
				result.github = data;
				result.github.enabled = integration.enabled;
				result.github.total_posts = integration.total_posts;
				result.github.last_fetched = integration.last_fetched;
				break;
		}
	});

	return result;
}

function IntegrationInterface({ client }: { client: FetchedCustomerData }) {
	const [input, setInput] = useState<IntegrationUpdateInput>(getIntegrationData(client));
	const { setData } = useContext(CustomerContext);

	useEffect(() => {
		setInput(getIntegrationData(client));
	}, [client]);

	async function submit() {
		const response = (await (await fetch("/api/integrations/update", { method: "POST", body: JSON.stringify(input) })).json()) as { data?: FetchedCustomerData; error?: string };
		console.log(response);
		if (response.data) {
			const { data: result } = response;
			setData((data) => data.map((client) => (client.id === result.id ? result : client)));
			setInput(getIntegrationData(result));
		} else {
			console.error(response.error);
		}
	}

	return (
		<div>
			<div className="flex flex-row gap-4 p-4 integration-form">
				<div className="w-full">
					<div className="flex flex-row gap-2 items-center">
						<div>{getPlatformIcon(Platform.TWITTER)}</div>
						<h4>Twitter</h4>
						<button
							className="ml-auto border-base-border border-2 hover:bg-base-tertiary duration-300 transition-colors text-white px-4 py-0.5 rounded-xl"
							onClick={() => setInput((input) => ({ ...input, twitter: { ...input.twitter, enabled: !input.twitter.enabled } }))}
						>
							{input.twitter.enabled ? "Disable" : "Enable"}
						</button>
					</div>
					<hr className="border-base-border border my-2" />
					<fieldset className="flex flex-col gap-2 justify-start w-full">
						<label>Username</label>
						<input type="text" value={input.twitter.username} onChange={(e) => setInput((input) => ({ ...input, twitter: { ...input.twitter, username: e.target.value } }))} />
					</fieldset>
					<div className="flex flex-row gap-2 justify-center text-gray-500 text-sm mt-2">
						{input.twitter.last_fetched && <p>Last Fetched: {moment(input.twitter.last_fetched).calendar()}</p>}
						<p>Total Posts: {input.twitter.total_posts}</p>
					</div>
				</div>
				<div className="w-full">
					<div className="flex flex-row gap-2 items-center">
						<div>{getPlatformIcon(Platform.REDDIT)}</div>
						<h4>Reddit</h4>
						<button
							className="ml-auto border-base-border border-2 hover:bg-base-tertiary duration-300 transition-colors text-white px-4 py-0.5 rounded-xl"
							onClick={() => setInput((input) => ({ ...input, reddit: { ...input.reddit, enabled: !input.reddit.enabled } }))}
						>
							{input.reddit.enabled ? "Disable" : "Enable"}
						</button>
					</div>
					<hr className="border-base-border border my-2" />
					<fieldset className="flex flex-col gap-2 justify-start w-full">
						<label>Username</label>
						<input type="text" value={input.reddit.username} onChange={(e) => setInput((input) => ({ ...input, reddit: { ...input.reddit, username: e.target.value } }))} />
					</fieldset>
					<div className="flex flex-row gap-2 justify-center text-gray-500 text-sm mt-2">
						{input.reddit.last_fetched && <p>Last Fetched: {moment(input.reddit.last_fetched).calendar()}</p>}
						<p>Total Posts: {input.reddit.total_posts}</p>
					</div>
				</div>

				<div className="w-full">
					<div className="flex flex-row gap-2 items-center">
						<div>{getPlatformIcon(Platform.GITHUB)}</div>
						<h4>GitHub</h4>
						<button
							className="ml-auto border-base-border border-2 hover:bg-base-tertiary duration-300 transition-colors text-white px-4 py-0.5 rounded-xl"
							onClick={() => setInput((input) => ({ ...input, github: { ...input.github, enabled: !input.github.enabled } }))}
						>
							{input.github.enabled ? "Disable" : "Enable"}
						</button>
					</div>
					<hr className="border-base-border border my-2" />
					<fieldset className="flex flex-col gap-2 justify-start w-full">
						<label>Username</label>
						<input type="text" value={input.github.username} onChange={(e) => setInput((input) => ({ ...input, github: { ...input.github, username: e.target.value } }))} />
						<label>Auth Token</label>
						<input
							type="text"
							className="font-mono"
							value={input.github.auth_token}
							onChange={(e) => setInput((input) => ({ ...input, github: { ...input.github, auth_token: e.target.value } }))}
						/>
					</fieldset>
					<div className="flex flex-row gap-2 justify-center text-gray-500 text-sm mt-2">
						{input.github.last_fetched && <p>Last Fetched: {moment(input.github.last_fetched).calendar()}</p>}
						<p>Total Posts: {input.github.total_posts}</p>
					</div>
				</div>
			</div>
			<div className="flex justify-center items-center">
				<button type="submit" className="border-base-border border-2 hover:bg-base-tertiary duration-300 transition-colors text-white px-4 py-1 rounded-xl" onClick={submit}>
					Save
				</button>
			</div>
		</div>
	);
}
