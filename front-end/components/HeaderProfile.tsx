import { Session } from "next-auth";

export default function HeaderProfile({ session }: { session: Session }) {
	return (
		<div className="flex items-center">
			<div className="flex-shrink-0">
				<img className="h-8 w-8 rounded-full" src={session.user?.image || ""} alt="" />
			</div>
			{/* <div className="ml-3">
				<div className="text-base font-medium text-white">{session.user?.name || "No Name"}</div>
				<div className="text-sm font-medium text-cool-gray-400">{session.user?.email || "No Email"}</div>
			</div> */}
		</div>
	);
}
