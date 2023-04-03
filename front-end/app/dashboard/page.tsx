import { getSession } from "utils/session";
import { redirect } from "next/navigation";
import { getCustomers } from "api/users";

export default async function page() {
	return <div>This is the home page</div>;
}
