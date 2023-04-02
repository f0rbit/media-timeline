import { Express } from "express";
import { update } from "./server";
import { getPosts } from "./api/posts";

export function configureRoutes(app: Express) {
	app.get("/hello", (req, res) => {
		res.send("Hello World!");
	});

	app.get("/reload", (req, res) => {
		update();
		res.status(200).end();
	});

	app.get("/posts", (req, res) => {
		res.json(getPosts());
	});
}
