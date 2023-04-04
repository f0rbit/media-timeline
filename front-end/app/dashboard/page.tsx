import { getSession } from "utils/session";
import { redirect } from "next/navigation";
import { getCustomers } from "api/users";
import CustomerData from "@/components/CustomerData";
import AddClient from "@/components/AddClient";
import Integrations from "@/components/Integrations";

export default async function page() {
	return (
		<div className="flex flex-col gap-2">
			<p>Home Dashboard</p>
			<section>Client Overview</section>
			<section>Usage Metrics</section>
		</div>
	);
}
