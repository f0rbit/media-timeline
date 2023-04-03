import { Express } from "express";
import { Platform, Post } from "@prisma/client";
import { getPosts, getGroupedPosts, PostWithData, loadPosts } from "./api/posts";
import { update } from "./server";

export function configureRoutes(app: Express) {
	app.get("/hello", (req, res) => {
		res.send("Hello World!");
	});

	app.get("/reload", async (req, res) => {
		await loadPosts();
		await update();
		res.status(200).end();
	});

	app.get("/posts", async (req, res) => {
		const platform = req.query.platform as Platform | undefined;
		const groupByDate = req.query.groupByDate as "day" | "month" | undefined;
		const combineCommits = req.query.combineCommits === "true";
		const skip = req.query.skip ? parseInt(req.query.skip as string) : undefined;
		const take = req.query.take ? parseInt(req.query.take as string) : undefined;

		if (groupByDate) {
			const groupedPosts = await getGroupedPosts(platform, groupByDate, skip, take);
			if (combineCommits) {
				const combinedGroupedPosts = groupedPosts.map(({ date, posts }) => ({
					date,
					posts: groupSequentialCommits(posts),
				}));
				res.json(combinedGroupedPosts);
			} else {
				res.json(groupedPosts);
			}
		} else {
			const posts = await getPosts(platform, skip, take);
			res.json(combineCommits ? groupSequentialCommits(posts) : posts);
		}
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
				const object = { ...lastPost.data, id: lastPost.id, posted_at: lastPost.posted_at };
				lastPost.commits = [object];
			}
			lastPost.commits.push({ ...post.data, id: post.id, posted_at: post.posted_at });
			lastPost.posted_at = post.posted_at;
		} else {
			combinedPosts.push(post);
		}
	});

	return combinedPosts;
}
