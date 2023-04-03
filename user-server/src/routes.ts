import { Express } from "express";
import { getPosts } from "./api/posts";
import { update } from "./server";

export function configureRoutes(app: Express) {
	app.get("/hello", (req, res) => {
		res.send("Hello World!");
	});

	app.get("/reload", (req, res) => {
		update();
		res.status(200).end();
	});

	app.get("/posts", async (req, res) => {
		const posts = await getPosts();
		res.json(posts);
	});
}
