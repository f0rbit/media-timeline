import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./packages/schema/src/database.ts",
	out: "./migrations",
	dialect: "sqlite",
	tablesFilter: ["media_*"],
	...(process.env.DATABASE_URL && {
		dbCredentials: {
			url: process.env.DATABASE_URL,
		},
	}),
});
