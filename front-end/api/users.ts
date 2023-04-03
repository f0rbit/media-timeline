import getPrismaClient from "utils/prisma";

export async function getCustomers(id: string) {
	return await getPrismaClient().customer.findMany({
		where: {
			user_id: id,
		},
	});
}

export type FetchedCustomerData = Awaited<ReturnType<typeof getCustomerData>>;

export async function getCustomerData(id: string) {
	return await getPrismaClient().customer.findMany({
		where: {
			user_id: id,
		},
		include: {
			server: true,
			integrations: true,
		},
	});
}
