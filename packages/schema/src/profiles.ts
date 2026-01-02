import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SlugSchema = z.string().min(3, "Slug must be at least 3 characters").max(50, "Slug must be at most 50 characters").regex(slugRegex, "Slug must be lowercase alphanumeric with hyphens, no leading/trailing hyphens");

export const CreateProfileSchema = z.object({
	slug: SlugSchema,
	name: z.string().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
	description: z.string().max(500, "Description must be at most 500 characters").optional(),
	theme: z.string().max(50).optional(),
});

export const UpdateProfileSchema = z.object({
	slug: SlugSchema.optional(),
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).nullable().optional(),
	theme: z.string().max(50).nullable().optional(),
});

export const FilterTypeSchema = z.enum(["include", "exclude"]);
export const FilterKeySchema = z.enum(["repo", "subreddit", "keyword", "twitter_account"]);

export const AddFilterSchema = z.object({
	account_id: z.string(),
	filter_type: FilterTypeSchema,
	filter_key: FilterKeySchema,
	filter_value: z.string().min(1, "Filter value is required").max(200, "Filter value too long"),
});

export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type AddFilterInput = z.infer<typeof AddFilterSchema>;
export type FilterType = z.infer<typeof FilterTypeSchema>;
export type FilterKey = z.infer<typeof FilterKeySchema>;
