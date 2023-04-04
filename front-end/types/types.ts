import { z } from "zod";

// export type ClientCreationInput = {
// 	name: string;
// 	cluster: string;
// };

export type ClientCreationInput = z.infer<typeof clientCreationInputValidator>;

export const clientCreationInputValidator = z.object({
	name: z.string(),
	cluster: z.string(),
});
