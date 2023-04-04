import { getSession } from "utils/session";
import { redirect } from "next/navigation";
import { getCustomers } from "api/users";
import CustomerData from "@/components/CustomerData";
import Clients from "@/components/Clients";
import AddClient from "@/components/AddClient";

export default async function page() {
	return (
		<div>
			<section className="flex flex-col gap-2 w-full">
				<div className="flex flex-row gap-2 items-center">
					<h2 className="font-bold text-xl">Clients</h2>
					{/* <button className="border  rounded-md px-4 py-0.5">Add Client</button> */}
					<AddClient />
				</div>
				<div>
					<Clients />
				</div>
			</section>
			{/* <CustomerData /> */}
		</div>
	);
}
