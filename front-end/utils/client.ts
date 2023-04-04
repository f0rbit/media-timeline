import { FetchedCustomerData } from "api/users";

export function getClientServer(client: FetchedCustomerData) {
	const server = client?.server?.cluster;
	return server ? (server.ipv6 ?? server.ipv4) + "/" + client.id : null;
}
