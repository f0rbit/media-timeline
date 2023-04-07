"use client";

import { useContext, useState } from "react";
import { CustomerContext } from "./CustomerProvider";
import { FetchedCustomerData } from "api/users";
import { IntegrationIcons } from "@/components/IntegrationIcons";
import Link from "next/link";
import { getClientServer } from "utils/client";
import { Trash } from "lucide-react";
import Modal, { ModalLayout } from "./BaseModal";

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
		<div key={client.id} className="border-2 border-base-border bg-base-secondary rounded-xl ">
			<div className="flex flex-row gap-x-8 items-center px-6 py-2.5 relative flex-wrap pr-16">
				<h3 className="font-semibold text-xl">{client.name}</h3>
				<div className="flex flex-row gap-1 items-center">
					<p className="scale-75 font-mono py-0.5 px-2 rounded-xl border-base-border border-2 bg-base-tertiary">CLUSTER</p>
					<p className="font-mono">{client.server?.cluster_name}</p>
				</div>
				<Link href={`/dashboard/integrations`} className="px-4 py-1 bg-base-tertiary rounded-xl min-w-max">
					<IntegrationIcons client={client} />
				</Link>
				<div className="flex flex-row gap-1 items-center min-w-max">
					<p className="scale-75 font-mono py-0.5 px-2 rounded-xl border-base-border border-2 bg-base-tertiary">POSTS</p>
					<p className="font-mono">{getPostCount(client)}</p>
				</div>
				<div className="flex-row gap-1 items-center hidden lg:flex">
					<p className="scale-75 font-mono py-0.5 px-2 rounded-xl border-base-border border-2 bg-base-tertiary">URL</p>
					<p className="font-mono">{getClientServer(client)}</p>
				</div>

				<DeleteClientButton client={client} />
			</div>
		</div>
	);
}

function DeleteClientButton({ client }: { client: FetchedCustomerData }) {
	const [open, setOpen] = useState(false);

	return (
		<div className="absolute right-2 top-0 h-full flex items-center justify-center">
			<Modal isOpen={open} onClose={() => setOpen(false)}>
				<ModalLayout onClose={() => setOpen(false)}>
					<h2 className="font-bold text-xl">Delete Client</h2>
					<p>Are you sure you want to delete this client?</p>
					<div className="flex flex-row gap-2 justify-center mt-3">
						<button type="button" className="bg-red-500 text-white rounded-xl px-4 py-1" onClick={() => setOpen(false)}>
							Delete
						</button>
						<button type="button" className="bg-base-tertiary text-white rounded-xl px-4 py-1" onClick={() => setOpen(false)}>
							Cancel
						</button>
					</div>
				</ModalLayout>
			</Modal>
			<button
				type="button"
				title="Delete Client"
				onClick={() => setOpen(true)}
				className="bg-base-secondary hover:bg-base-tertiary p-2 rounded-xl border-2 border-base-border transition-colors duration-300"
			>
				<Trash />
			</button>
		</div>
	);
}

function getPostCount(client: FetchedCustomerData) {
	let count = 0;
	for (const integration of client.integrations) {
		count += integration.total_posts;
	}
	return count;
}
