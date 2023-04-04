"use server";

import getPrismaClient from "utils/prisma";

export default async function ClusterOptions() {
	const clusters = await getPrismaClient().serverCluster.findMany();

	return <></>;
}
