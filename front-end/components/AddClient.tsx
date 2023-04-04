"use client";

import { useContext, useState } from "react";
import BaseModal, { ModalLayout } from "./BaseModal";
import ClusterOptions from "./ClusterOptions";
import { CustomerContext } from "./CustomerProvider";
import { ClientCreationInput } from "types/types";
import { Client } from "@prisma/client";
import { FetchedCustomerData } from "api/users";

const DEFAULT_CLUSTER = "Australia-1";

export default function AddClient() {
	const [data, setData] = useState<ClientCreationInput>({
		name: "",
		cluster: DEFAULT_CLUSTER,
	});
	const [showing, setShowing] = useState(false);
	const { clusters } = useContext(CustomerContext);
	const { setData: updateData } = useContext(CustomerContext);

	async function submit() {
		const response = (await (await fetch("/api/client/create", { method: "POST", body: JSON.stringify(data) })).json()) as { data?: FetchedCustomerData; error?: string };
		console.log(response);
		if (response.data) {
			const { data: result } = response;
			setData({ name: "", cluster: DEFAULT_CLUSTER });

			// update customer data
			updateData((data) => [...data, result]);
		} else {
			console.error(response.error);
		}
		setShowing(false);
	}

	return (
		<>
			<button onClick={() => setShowing(true)} className="border-2 hover:bg-base-secondary border-base-border rounded-xl px-4 py-1 duration-300 transition-colors">
				Add Client
			</button>
			<BaseModal isOpen={showing} onClose={() => setShowing(false)}>
				<ModalLayout onClose={() => setShowing(false)} className="w-1/4">
					<h2 className="font-bold text-2xl">Add Client</h2>
					<hr className="border-[#282c3e] my-2 border" />
					<fieldset className="flex flex-col gap-2 justify-start w-full">
						<label>Name</label>
						<input value={data.name} type="text" className="w-full" onChange={(e) => setData((data) => ({ ...data, name: e.target.value }))} />
						<label>Cluster</label>
						<select value={data.cluster} onChange={(e) => setData((data) => ({ ...data, cluster: e.target.value }))}>
							{clusters.map((cluster, index) => (
								<option key={index} value={cluster.name}>
									{cluster.name}
								</option>
							))}
						</select>
					</fieldset>
					<div className="flex gap-2 justify-center pt-4">
						<button type="submit" className="border-[#282c3e] border-2 text-white rounded-xl px-4 py-1 hover:bg-base-secondary transition-colors  duration-300" onClick={submit}>
							Add Client
						</button>
					</div>
				</ModalLayout>
			</BaseModal>
		</>
	);
}
