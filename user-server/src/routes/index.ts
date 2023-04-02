import { Router } from "../deps.ts";
import config from "../config.ts";

const router = new Router();

router.get("/", (ctx) => {
	ctx.response.body = "Welcome to the user-specific Deno server!";
});

router.get("/api/data", (ctx) => {
	// Replace this with your actual data fetching and processing logic
	const data = {
		message: "Sample data from the user-specific Deno server",
	};
	ctx.response.body = data;
});

// if the server is running in "DEV" mode, then create a /config endpoint that prints out the config data
if (config?.mode === "DEV") {
    router.get("/config", (ctx) => {
        ctx.response.body = config;
    });
}

export default router;
