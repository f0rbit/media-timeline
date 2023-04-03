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

export async function getPosts(platform?: Platform, skip?: number, take?: number) {
	const posts = await prisma.post.findMany({
		where: {
			platform,
		},
		orderBy: {
			posted_at: "desc",
		},
		skip: skip,
		take: take,
	});

	return posts.map((post) => getPostWithData(post));
}

export async function getGroupedPosts(platform: Platform | undefined, groupByDate: "day" | "month", skip?: number, take?: number): Promise<{ date: string; posts: PostWithData[] }[]> {
	const posts = await getPosts(platform, skip, take);

	const groupedPosts: { [key: string]: PostWithData[] } = {};

	posts.forEach((post) => {
		const date = new Date(post.posted_at);
		const key = groupByDate === "month" ? `${date.getFullYear()}-${date.getMonth() + 1}` : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

		if (!groupedPosts[key]) {
			groupedPosts[key] = [];
		}
		groupedPosts[key].push(post);
	});

	return Object.entries(groupedPosts).map(([date, posts]) => ({
		date,
		posts,
	}));
}

export type PostWithData = ReturnType<typeof getPostWithData>;

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
