"use client";

import { useContext } from "react";
import { CustomerContext } from "./CustomerProvider";
import { FetchedCustomerData } from "api/users";

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
		<div key={client.id} className="border-2 border-base-border bg-base-secondary rounded-xl p-4 w-full">
			<h3 className="font-semibold text-xl">{client.name}</h3>
			<pre>ID: {client.id}</pre>
			<pre>SERVER: {client.server_id}</pre>
			<pre>INTEGRATIONS: {JSON.stringify(client.integrations, null, 2)}</pre>
		</div>
	);
}
