import { Express } from "express";

export function configureRoutes(app: Express) {
	// Import your route handlers here
	// import yourHandler from './yourHandler';

	// Add your API routes here
	// app.get('/your-route', yourHandler);

	app.get("/hello", (req, res) => {
		res.send("Hello World!");
	});
}
