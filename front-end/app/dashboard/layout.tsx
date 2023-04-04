import { CustomerProvider } from "@/components/CustomerProvider";
import Links from "@/components/DashboardLinks";
import HeaderProfile from "@/components/HeaderProfile";
import { FetchedCustomerData, getCustomerData } from "api/users";
import { redirect } from "next/navigation";
import getPrismaClient from "utils/prisma";
import { getSession } from "utils/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await getSession();
	if (!session || !session.user) {
		redirect("/login");
		return <div>Redirecting...</div>;
	}

	const data = (await getCustomerData(session.user.id)) as FetchedCustomerData[];
	const clusters = await getPrismaClient().serverCluster.findMany();

	// the dashboard will be split into 3 sections:
	// there is a sidebar, which will have the title in the top left, and then a list of links to the different pages below it
	// these links will be rounded buttons, and if selected will be highlighted in blue
	// the top bar will have the title of the page, and then session information, so notifications and a profile button
	// the profile button will either be "login" or the user's icon and "logout"
	// the main section will be the page itself, and will be the main content of the page
	return (
		<CustomerProvider data={data} clusters={clusters}>
			<div className="flex flex-row min-h-screen h-full overflow-hidden bg-base-primary">
				<section className="flex-shrink-0 w-80 h-full overflow-y-auto">
					<div className=" p-4 h-full">
						<nav className="flex flex-col gap-4 p-4 rounded-2xl bg-base-secondary h-full border-2 border-base-border">
							<h1 className="font-bold text-center text-gray-200 text-3xl">media-timeline</h1>
							<Links />
						</nav>
					</div>
				</section>
				<section className="w-full  h-full flex flex-col text-white">
					<header className="flex flex-row gap-2 justify-end p-2 pr-4">
						<HeaderProfile session={session} />
					</header>
					<main className="p-2  flex-1 overflow-y-auto">{children}</main>
				</section>
			</div>
		</CustomerProvider>
	);
}
