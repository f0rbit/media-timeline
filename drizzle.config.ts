import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/schema/database.ts",
	out: "./migrations",
	dialect: "sqlite",
	...(process.env.DATABASE_URL && {
		dbCredentials: {
			url: process.env.DATABASE_URL,
		},
	}),
});
