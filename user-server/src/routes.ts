import { Express } from "express";
import { Platform, Post } from "@prisma/client";
import { getPosts, getGroupedPosts, PostWithData } from "./api/posts";
import { update } from "./server";

export function configureRoutes(app: Express) {
	app.get("/hello", (req, res) => {
		res.send("Hello World!");
	});

	app.get("/reload", async (req, res) => {
		await update();
		res.status(200).end();
	});

	app.get("/posts", async (req, res) => {
		const platform = req.query.platform as Platform | undefined;
		const groupByDate = req.query.groupByDate as "day" | "month" | undefined;
		const combineCommits = req.query.combineCommits === "true";

		let posts = await (groupByDate ? getGroupedPosts(platform, groupByDate) : getPosts(platform));

		if (combineCommits) {
			posts = groupSequentialCommits(posts);
		}

		res.json(posts);
	});
}

function groupSequentialCommits(posts: any[]) {
	const combinedPosts: PostWithData[] = [];

	posts.forEach((post) => {
		const lastPost = combinedPosts[combinedPosts.length - 1] as any;

		if (
			lastPost &&
			lastPost.platform == Platform.GITHUB &&
			lastPost.data.project === post.data.project &&
			(new Date(post.posted_at).getTime() - new Date(lastPost.posted_at).getTime()) / 1000 < 60
		) {
			if (!lastPost.data.commits) {
				const object = lastPost;
				lastPost.commits = [object.data];
			}
			lastPost.commits.push(post.data);
			lastPost.posted_at = post.posted_at;
		} else {
			combinedPosts.push(post);
		}
	});

	return combinedPosts;
}
