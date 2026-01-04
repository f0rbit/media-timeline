import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./packages/schema/src/database.ts",
	out: "./migrations",
	dialect: "sqlite",
	// Include media_* tables and corpus_snapshots (from @f0rbit/corpus)
	tablesFilter: ["media_*", "corpus_snapshots"],
	...(process.env.DATABASE_URL && {
		dbCredentials: {
			url: process.env.DATABASE_URL,
		},
	}),
});
