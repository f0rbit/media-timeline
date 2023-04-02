// this file handles the server, which fetches posts from various website periodically and stores them in the database

import { Post } from "@prisma/client";
import { setPosts } from "./api/posts";

export function update() {
	// fetch posts from twitter
	// fetch posts from reddit
	// fetch commits on github

	load();
}

export function load() {
	// load in from db

	setPosts([]);
}
