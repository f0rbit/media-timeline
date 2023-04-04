"use client";

import { useContext } from "react";
import { CustomerContext } from "./CustomerProvider";
import { FetchedCustomerData } from "api/users";
import { IntegrationIcons } from "@/components/IntegrationIcons";
import Link from "next/link";
import { getClientServer } from "utils/client";

export default function Clients() {
	const { data } = useContext(CustomerContext);

	return (
		<div className="rounded-xl flex gap-2 flex-col">
			{data.map((client, index) => (
				<ClientComponent client={client} key={index} />
			))}
		</div>
	);
}

function ClientComponent({ client }: { client: FetchedCustomerData }) {
	return (
		<div key={client.id} className="border-2 border-base-border bg-base-secondary rounded-xl w-full">
			<div className="flex flex-row gap-8 items-center px-6 py-2.5">
				<h3 className="font-semibold text-xl min-w-[10%]">{client.name}</h3>
				<div className="flex flex-row gap-1 items-center min-w-[10%]">
					<p className="scale-75 font-mono py-0.5 px-2 rounded-xl border-base-border border-2 bg-base-tertiary">CLUSTER</p>
					<p className="font-mono">{client.server?.cluster_name}</p>
				</div>
				<Link href={`/dashboard/integrations`} className="px-4 py-1 bg-base-tertiary rounded-xl min-w-max">
					<IntegrationIcons client={client} />
				</Link>
				<div className="flex flex-row gap-1 items-center min-w-max">
					<p className="scale-75 font-mono py-0.5 px-2 rounded-xl border-base-border border-2 bg-base-tertiary">URL</p>
					<p className="font-mono">{getClientServer(client)}</p>
				</div>
			</div>
		</div>
	);
}
