// Import the dotenv library
import { config as dotenv } from "https://deno.land/x/dotenv/mod.ts";

// Load the environment variables from the .env file
dotenv();

const port = Deno.env.get("PORT");

// Define the configuration object
const config = {
  databaseUrl: Deno.env.get("DATABASE_URL"),
  mode: Deno.env.get("MODE") as "DEV" | "PROD",
  port: port ? parseInt(port) : 3000,
  twitterSecret: Deno.env.get("TWITTER_SECRET"),
  twitterPublic: Deno.env.get("TWITTER_PUBLIC"),
  redditSecret: Deno.env.get("REDDIT_SECRET"),
  redditPublic: Deno.env.get("REDDIT_PUBLIC"),
};

// Export the configuration object
export default config;
