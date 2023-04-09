"use client";

import { useContext } from "react";
import { CustomerContext } from "./CustomerProvider";
import { FetchedCustomerData } from "api/users";

export default function Usage() {
	const { data } = useContext(CustomerContext);

	return (
		<div className="rounded-xl flex gap-2 flex-col">
			{data.map((client, index) => (
				<UsageComponent client={client} key={index} />
			))}
		</div>
	);
}

function UsageComponent({ client }: { client: FetchedCustomerData }) {
	return <pre>{JSON.stringify(client?.server?.metrics)}</pre>;
}
