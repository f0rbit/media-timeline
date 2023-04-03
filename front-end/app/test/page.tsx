import Login from "@/components/Login";
import { signIn, useSession } from "next-auth/react";

export default async function Index() {
	return (
		<div className="bg-cool-gray-900 text-cool-gray-50">
			<p>Welcome!</p>
			<div className="bg-cool-gray-800">
				<Login />
			</div>
		</div>
	);
}
