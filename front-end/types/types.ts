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

export type IntegrationUpdateInput = z.infer<typeof integrationUpdateInputValidator>;

export const integrationUpdateInputValidator = z.object({
	client_id: z.string().uuid(),
	reddit: z.object({
		enabled: z.boolean(),
		username: z.string(),
	}),
	twitter: z.object({
		enabled: z.boolean(),
		username: z.string(),
	}),
	github: z.object({
		enabled: z.boolean(),
		username: z.string(),
		auth_token: z.string(),
	}),
});
