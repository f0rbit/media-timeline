import { createClient } from "api/users";
import { NextApiRequest, NextApiResponse } from "next";
import { clientCreationInputValidator } from "types/types";
import { getSessionID } from "utils/api";

export default async function endpoint(req: NextApiRequest, res: NextApiResponse) {
	const id = await getSessionID(req, res);
	if (!id) return;

	const input = clientCreationInputValidator.parse(JSON.parse(req.body));

	const { data, error } = await createClient(input, id);
	if (error) {
		res.status(500).json({ error });
	} else {
		res.status(200).json({ data });
	}
}
