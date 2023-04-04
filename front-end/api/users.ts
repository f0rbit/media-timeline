import { ClientCreationInput } from "types/types";
import getPrismaClient from "utils/prisma";

const CLIENT_INCLUDE = {
	server: true,
	integrations: true,
};

export async function getCustomers(id: string) {
	return await getPrismaClient().client.findMany({
		where: {
			user_id: id,
		},
	});
}

export type FetchedCustomerData = Awaited<ReturnType<typeof getCustomerData>>[number];

export async function getCustomerData(id: string) {
	return await getPrismaClient().client.findMany({
		where: {
			user_id: id,
		},
		include: CLIENT_INCLUDE,
	});
}

export async function createClient(input: ClientCreationInput, id: string) {
	// create a new server on the cluster
	try {
		const server = await createClientServer(input.cluster, id);

		const client: FetchedCustomerData = await getPrismaClient().client.create({
			data: {
				name: input.name,
				user_id: id,
				server_id: server.id,
			},
			include: CLIENT_INCLUDE,
		});

		return { data: client, error: null };
	} catch (error) {
		return { data: null, error: error };
	}
}

export async function createClientServer(cluster_name: string, id: string) {
	// create a new server on the cluster

	return await getPrismaClient().clientServer.create({
		data: {
			cluster_name: cluster_name,
		},
	});
}
