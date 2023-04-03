// src/server/db/client.ts
import { PrismaClient } from "@prisma/client";

// declare global {
// 	// eslint-disable-next-line no-var
// 	var prisma: PrismaClient | undefined;
// }

// export const prisma = global.prisma || new PrismaClient();
// global.prisma = prisma;

var prisma: PrismaClient | null = null;

export default function getPrismaClient() {
	if (!prisma) {
		prisma = new PrismaClient();
	}
	return prisma;
}
