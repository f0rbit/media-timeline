"use client";

import { useContext } from "react";
import { CustomerContext } from "./CustomerProvider";

export default function Clients() {
	const { data } = useContext(CustomerContext);

	return (
		<div className="rounded-md flex gap-2 flex-wrap">
			{data.map((client) => (
				<div key={client.id} className="border rounded-md p-2 w-max whitespace-nowrap" style={{ flex: "1 1 0px" }}>
					<h3>ID: {client.id}</h3>
					<p>SERVER: {client.server_id}</p>
					<pre>{JSON.stringify(client.integrations, null, 2)}</pre>
				</div>
			))}
		</div>
	);
}
