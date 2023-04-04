import { unstable_getServerSession } from "next-auth";
import { authOptions } from "pages/api/auth/[...nextauth]";

export async function getSession() {
	return await unstable_getServerSession(authOptions);
}

// Wrapper for unstable_getServerSession https://next-auth.js.org/configuration/nextjs

import type { GetServerSidePropsContext } from "next";

// Next API route example - /pages/api/restricted.ts
export const getServerAuthSession = async (ctx: { req: GetServerSidePropsContext["req"]; res: GetServerSidePropsContext["res"] }) => {
	return await unstable_getServerSession(ctx.req, ctx.res, authOptions);
};
