import { Platform, Prisma } from "@prisma/client";
import prisma from "./prisma";
import { parseRedditData } from "./reddit";
import { parseTwitterData } from "./twitter";

export async function addPost(post: Prisma.PostCreateInput) {
	console.log("Adding post", post);
	const new_post = await prisma.post.create({
		data: post,
	});
}

export async function getTweets() {
	const tweets = await prisma.post.findMany({
		where: {
			platform: Platform.TWITTER,
		},
	});
	return tweets.map((tweet) => ({ ...tweet, ...parseTwitterData(JSON.parse(tweet.data?.toString() ?? "")) }));
}

export async function getRedditPosts() {
	const posts = await prisma.post.findMany({
		where: {
			platform: Platform.REDDIT,
		},
	});

	return posts.map((post) => ({ ...post, ...parseRedditData(JSON.parse(post.data?.toString() ?? "")) }));
}

export async function getPosts() {
	return await prisma.post.findMany();
}
