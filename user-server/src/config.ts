import dotenv from 'dotenv';

dotenv.config();

interface Config {
  DATABASE_URL: string;
  PORT: number;
}

const config: Config = {
  DATABASE_URL: process.env.DATABASE_URL || "",
  PORT: Number(process.env.PORT) || 3000,
};

if (config.DATABASE_URL === "") {
  throw new Error("DATABASE_URL is not set");
}

console.log("Loaded Config: ", config);

export default config;
