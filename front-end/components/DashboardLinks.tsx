"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
	{
		name: "Home",
		href: "/dashboard",
	},
	{
		name: "Integrations",
		href: "/dashboard/integrations",
	},
	{
		name: "Targets",
		href: "/dashboard/targets",
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
					<Link key={index} href={link.href} className={`rounded-md w-full text-left font-bold px-4 py-2 ${isActive ? "bg-button-selected text-button-accent" : ""}`}>
						{link.name}
					</Link>
				);
			})}
		</>
	);
}
