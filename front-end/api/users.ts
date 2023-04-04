import { Platform, Prisma } from "@prisma/client";
import { ClientCreationInput, IntegrationUpdateInput } from "types/types";
import getPrismaClient from "utils/prisma";

const CLIENT_INCLUDE = {
	server: {
		include: {
			cluster: true,
		},
	},
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

export async function updateIntegrations(input: IntegrationUpdateInput, id: string) {
	try {
		if (input.github) {
			// if (input.github.enabled) {
			// 	await upsertIntegration(Platform.GITHUB, input.client_id, input.github);
			// } else {
			// 	// remove github integration if exists
			// 	await getPrismaClient().integration.deleteMany({
			// 		where: {
			// 			client_id: input.client_id,
			// 			platform: Platform.GITHUB,
			// 		},
			// 	});
			// }
			await upsertIntegration(Platform.GITHUB, input.client_id, input.github);
		}
		if (input.twitter) {
			// if (input.twitter.enabled) {
			// 	// upsert twitter integration with data
			// 	await upsertIntegration(Platform.TWITTER, input.client_id, input.twitter);
			// } else {
			// 	// remove twitter integration if exists
			// 	await getPrismaClient().integration.deleteMany({
			// 		where: {
			// 			client_id: input.client_id,
			// 			platform: Platform.TWITTER,
			// 		},
			// 	});
			// }
			await upsertIntegration(Platform.TWITTER, input.client_id, input.twitter);
		}
		if (input.reddit) {
			// if (input.reddit.enabled) {
			// 	// upsert reddit integration with data
			// 	await upsertIntegration(Platform.REDDIT, input.client_id, input.reddit);
			// } else {
			// 	// remove reddit integration if exists
			// 	await getPrismaClient().integration.deleteMany({
			// 		where: {
			// 			client_id: input.client_id,
			// 			platform: Platform.REDDIT,
			// 		},
			// 	});
			// }
			await upsertIntegration(Platform.REDDIT, input.client_id, input.reddit);
		}

		// return updated client
		const client = (await getPrismaClient().client.findUnique({
			where: {
				id: input.client_id,
			},
			include: CLIENT_INCLUDE,
		})) as FetchedCustomerData;
		return { data: client, error: null };
	} catch (error) {
		return { data: null, error: error };
	}
}

async function upsertIntegration(platform: Platform, client_id: string, raw_data: any) {
	const enabled = raw_data.enabled;
	const data = { ...raw_data, enabled: undefined };
	await getPrismaClient().integration.upsert({
		where: { client_id_platform: { platform, client_id } },
		create: { data, platform, client_id, enabled },
		update: { data, enabled },
	});
}
