import cloudflare from "@astrojs/cloudflare";
import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [solidJs()],
	vite: {
		resolve: {
			alias: {
				"@": "/src",
			},
		},
	},
});
