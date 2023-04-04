"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
	{
		name: "Home",
		href: "/dashboard",
	},
	{
		name: "Clients",
		href: "/dashboard/clients",
	},
	{
		name: "Integrations",
		href: "/dashboard/integrations",
	},
	{
		name: "Usage",
		href: "/dashboard/usage",
	},
];

export default function Links() {
	const path = usePathname();
	return (
		<>
			{NAV_LINKS.map((link, index) => {
				const isActive = path === link.href;

				return (
					<Link
						key={index}
						href={link.href}
						className={`rounded-xl w-full text-left font-bold px-4 py-2 border-2 ${isActive ? "bg-base-primary text-gray-300 border-base-border" : " border-transparent text-gray-500"}`}
					>
						{link.name}
					</Link>
				);
			})}
		</>
	);
}
