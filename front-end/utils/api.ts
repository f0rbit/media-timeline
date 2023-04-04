import { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "./session";
import { FetchedCustomerData } from "api/users";

export async function getSessionID(req: NextApiRequest, res: NextApiResponse) {
	const session = await getServerAuthSession({ req, res });

	if (!session) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}
	if (!session.user) {
		res.status(440).json({ error: "Invalid Session" });
		return;
	}

	return session.user.id;
}
