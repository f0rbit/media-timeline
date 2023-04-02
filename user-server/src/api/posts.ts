import { Post, Prisma } from "@prisma/client";
import prisma from "./prisma";

var posts: Post[] = [];

export function setPosts(posts: Post[]) {
	posts = posts;
}

export function getPosts() {
	return posts;
}

function addPost(post: Prisma.PostCreateInput) {
	prisma.post.create({
		data: post,
	});
}

function hasPost(post: Post) {
	return posts.some((p) => p.id === post.id);
}
