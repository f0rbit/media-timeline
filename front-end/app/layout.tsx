import SessionWrapper from "@/components/SessionWrapper";
import "styles/global.css";

import { Inter } from "next/font/google";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html className={`${inter.variable} `}>
			<head />
			<body>
				<SessionWrapper>{children}</SessionWrapper>
			</body>
		</html>
	);
}
