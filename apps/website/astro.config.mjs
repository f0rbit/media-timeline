import solidJs from "@astrojs/solid-js";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "static",
	integrations: [solidJs()],
	vite: {
		resolve: {
			alias: {
				"@": "/src",
			},
		},
	},
});
