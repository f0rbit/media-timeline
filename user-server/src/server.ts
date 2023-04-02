import { Application } from "./deps.ts";
import config from "./config.ts";
import router from "./routes/index.ts";

const app = new Application();

// Use the router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Read port from config, default to 3000 if not found
const port = config?.port ?? 3000;

console.log(`API Server running on port ${port}`);
await app.listen({ port });


