import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const ROOT_DIR = process.cwd();
const DIST_DIR = join(ROOT_DIR, "dist");
const WEBSITE_DIR = join(ROOT_DIR, "apps/website");
const WEBSITE_DIST = join(WEBSITE_DIR, "dist");

async function build() {
	console.log("Building unified worker...\n");

	if (existsSync(DIST_DIR)) {
		console.log("Cleaning dist directory...");
		rmSync(DIST_DIR, { recursive: true });
	}
	mkdirSync(DIST_DIR, { recursive: true });

	console.log("Building Astro SSR...");
	await $`bun run --filter '@media-timeline/website' build`;

	// Astro with cloudflare adapter (mode: "advanced") outputs:
	// - _astro/          -> client assets
	// - _worker.js/      -> directory with worker code (index.js + chunks/)
	// - _routes.json     -> routing rules

	console.log("Copying client assets...");
	cpSync(join(WEBSITE_DIST, "_astro"), join(DIST_DIR, "_astro"), { recursive: true });

	console.log("Copying Astro worker...");
	cpSync(join(WEBSITE_DIST, "_worker.js"), join(DIST_DIR, "_astro-worker"), { recursive: true });

	console.log("Bundling server package...");
	await $`bun build src/worker.ts --outdir dist/server --target browser --format esm`;

	console.log("Generating unified worker entry...");

	const workerEntry = `
// Unified worker entry point
// Routes /media/api/* to Hono, everything else to Astro SSR

import { createUnifiedApp } from "./server/worker.js";
import astroHandler from "./_astro-worker/index.js";

export default {
  async fetch(request, env, ctx) {
    const app = createUnifiedApp(env, { fetch: astroHandler.fetch });
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    const { handleScheduled } = await import("./server/worker.js");
    return handleScheduled(event, env, ctx);
  }
};
`;

	writeFileSync(join(DIST_DIR, "_worker.js"), workerEntry.trim());

	const routesJson = join(WEBSITE_DIST, "_routes.json");
	if (existsSync(routesJson)) {
		cpSync(routesJson, join(DIST_DIR, "_routes.json"));
	}

	const assetsIgnore = `# Exclude worker code from static assets
_worker.js
_astro-worker
server
_routes.json
`;
	writeFileSync(join(DIST_DIR, ".assetsignore"), assetsIgnore);

	console.log("\nBuild complete!");
	console.log("   Worker entry:  dist/_worker.js");
	console.log("   Server code:   dist/server/");
	console.log("   Astro worker:  dist/_astro-worker/");
	console.log("   Client assets: dist/_astro/");
	console.log("\nDeploy with: bunx wrangler deploy");
}

build().catch(error => {
	console.error("Build failed:", error);
	process.exit(1);
});
