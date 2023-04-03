import GithubProvider from "next-auth/providers/github";
import env from "utils/env";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import getPrismaClient from "utils/prisma";
import NextAuth, { Session, type NextAuthOptions } from "next-auth";

export const authOptions: NextAuthOptions = {
	// Include user.id on session
	callbacks: {
		session({ session, user }) {
			const new_session = session as Session;
			if (new_session.user) {
				new_session.user.id = user.id;
			}
			return new_session;
		},
	},
	// Configure one or more authentication providers
	adapter: PrismaAdapter(getPrismaClient()),
	providers: [
		GithubProvider({
			clientId: env.GITHUB.CLIENT_ID,
			clientSecret: env.GITHUB.CLIENT_SECRET,
		}),
		// ...add more providers here
	],
	secret: env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
