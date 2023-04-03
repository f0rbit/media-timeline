import { Platform, Post, Prisma } from "@prisma/client";
import prisma from "./prisma";
import { parseRedditData } from "./reddit";
import { parseTwitterData } from "./twitter";
import { parseGithubData } from "./github";

export async function addPost(post: Prisma.PostCreateInput) {
	console.log("Adding post", post);
	const new_post = await prisma.post.create({
		data: post,
	});
}

export async function getPosts(platform?: Platform) {
	const posts = await prisma.post.findMany({
		where: {
			platform,
		},
	});

	return posts.map((post) => getPostWithData(post));
}

function getPostWithData(post: Post) {
	switch (post.platform) {
		case Platform.TWITTER:
			return { ...post, data: parseTwitterData(JSON.parse(post.data?.toString() ?? "")), platform: Platform.TWITTER };
		case Platform.REDDIT:
			return { ...post, data: parseRedditData(JSON.parse(post.data?.toString() ?? "")), platform: Platform.REDDIT };
		case Platform.GITHUB:
			return { ...post, data: parseGithubData(JSON.parse(post.data?.toString() ?? "")), platform: Platform.GITHUB };
		default:
			return { ...post, data: {}, platform: null };
	}
}
