import { describe, expect, it } from "bun:test";
import type { CommitGroup, CommitPayload, PullRequestPayload, TimelineItem } from "../../src/schema";
import { type TimelineEntry, groupByDate, groupCommits } from "../../src/timeline";

type CommitItem = TimelineItem & { payload: CommitPayload };
type PRItem = TimelineItem & { payload: PullRequestPayload };

const isCommitGroup = (entry: TimelineEntry): entry is CommitGroup => entry.type === "commit_group";
const isCommitItem = (item: TimelineItem): item is CommitItem => item.type === "commit" && item.payload.type === "commit";

const makeCommitItem = (sha: string, timestamp: string, repo = "user/repo", branch = "main"): CommitItem => ({
	id: `commit-${sha}`,
	platform: "github",
	type: "commit",
	timestamp,
	title: `Commit ${sha.slice(0, 7)}`,
	url: `https://github.com/${repo}/commit/${sha}`,
	payload: {
		type: "commit",
		sha,
		message: `feat: commit ${sha.slice(0, 7)}`,
		repo,
		branch,
		additions: 10,
		deletions: 5,
		files_changed: 2,
	},
});

const makePRItem = (
	number: number,
	timestamp: string,
	repo = "user/repo",
	options: {
		merge_commit_sha?: string | null;
		commit_shas?: string[];
		state?: "open" | "closed" | "merged";
	} = {}
): PRItem => ({
	id: `pr-${repo}-${number}`,
	platform: "github",
	type: "pull_request",
	timestamp,
	title: `PR #${number}`,
	url: `https://github.com/${repo}/pull/${number}`,
	payload: {
		type: "pull_request",
		repo,
		number,
		title: `Pull Request #${number}`,
		state: options.state ?? "merged",
		action: "closed",
		head_ref: "feature-branch",
		base_ref: "main",
		additions: 100,
		deletions: 50,
		changed_files: 5,
		commit_shas: options.commit_shas ?? [],
		merge_commit_sha: options.merge_commit_sha,
		commits: [],
	},
});

const extractCommitSha = (item: TimelineItem): string | undefined => {
	if (isCommitItem(item)) {
		return item.payload.sha;
	}
	return undefined;
};

describe("deduplicateCommitsFromPRs (via groupCommits)", () => {
	it("returns commits unchanged when no PRs exist", () => {
		const commits = [makeCommitItem("aaa111", "2024-01-15T14:00:00Z"), makeCommitItem("bbb222", "2024-01-15T13:00:00Z"), makeCommitItem("ccc333", "2024-01-15T12:00:00Z")];

		const result = groupCommits(commits);

		// Should group all commits together (same repo, same day)
		expect(result).toHaveLength(1);
		const group = result[0];
		expect(group).toBeDefined();
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(3);
		}
	});

	it("removes commits that match a PR's merge_commit_sha", () => {
		const mergeCommitSha = "merge123abc";
		const commits = [
			makeCommitItem("aaa111", "2024-01-15T14:00:00Z"),
			makeCommitItem(mergeCommitSha, "2024-01-15T15:00:00Z"), // This is the merge commit
		];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				merge_commit_sha: mergeCommitSha,
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		// Should have 1 commit group (for orphan commit) + 1 PR
		const commitGroups = result.filter(isCommitGroup);
		const prItems = result.filter(e => e.type === "pull_request");

		expect(commitGroups).toHaveLength(1);
		expect(prItems).toHaveLength(1);

		// The orphan commit should only contain aaa111
		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(1);
			expect(extractCommitSha(group.commits[0] as TimelineItem)).toBe("aaa111");
		}
	});

	it("removes commits that match PR commit SHAs", () => {
		const prCommitSha1 = "prcommit1";
		const prCommitSha2 = "prcommit2";
		const commits = [makeCommitItem("orphan1", "2024-01-15T10:00:00Z"), makeCommitItem(prCommitSha1, "2024-01-15T11:00:00Z"), makeCommitItem(prCommitSha2, "2024-01-15T12:00:00Z")];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: [prCommitSha1, prCommitSha2],
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const commitGroups = result.filter(isCommitGroup);
		const prItems = result.filter(e => e.type === "pull_request");

		expect(commitGroups).toHaveLength(1);
		expect(prItems).toHaveLength(1);

		// Only orphan1 should remain
		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(1);
			expect(extractCommitSha(group.commits[0] as TimelineItem)).toBe("orphan1");
		}
	});

	it("enriches PR payload with commit details when commits match", () => {
		const prCommitSha = "enriched123";
		const commits = [makeCommitItem(prCommitSha, "2024-01-15T11:00:00Z")];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: [prCommitSha],
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const prItems = result.filter(e => e.type === "pull_request") as PRItem[];
		expect(prItems).toHaveLength(1);

		const enrichedPR = prItems[0];
		expect(enrichedPR?.payload.commits).toHaveLength(1);
		expect(enrichedPR?.payload.commits[0]?.sha).toBe(prCommitSha);
		expect(enrichedPR?.payload.commits[0]?.message).toBe(`feat: commit ${prCommitSha.slice(0, 7)}`);
		expect(enrichedPR?.payload.commits[0]?.url).toContain(prCommitSha);
	});

	it("handles PRs without merge_commit_sha", () => {
		const prCommitSha = "noMerge123";
		const commits = [makeCommitItem("orphan1", "2024-01-15T10:00:00Z"), makeCommitItem(prCommitSha, "2024-01-15T11:00:00Z")];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: [prCommitSha],
				merge_commit_sha: null, // Explicitly null
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const commitGroups = result.filter(isCommitGroup);
		const prItems = result.filter(e => e.type === "pull_request") as PRItem[];

		// Should still work - orphan1 not in PR
		expect(commitGroups).toHaveLength(1);
		expect(prItems).toHaveLength(1);

		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(1);
			expect(extractCommitSha(group.commits[0] as TimelineItem)).toBe("orphan1");
		}

		// PR should still be enriched
		expect(prItems[0]?.payload.commits).toHaveLength(1);
	});

	it("handles PRs with undefined merge_commit_sha", () => {
		const prCommitSha = "undefinedMerge";
		const commits = [makeCommitItem(prCommitSha, "2024-01-15T11:00:00Z")];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: [prCommitSha],
				// merge_commit_sha is undefined
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const prItems = result.filter(e => e.type === "pull_request") as PRItem[];
		expect(prItems).toHaveLength(1);
		expect(prItems[0]?.payload.commits).toHaveLength(1);
	});

	it("handles mixed scenario with multiple PRs and commits", () => {
		const commits = [
			makeCommitItem("orphan1", "2024-01-15T09:00:00Z"),
			makeCommitItem("orphan2", "2024-01-15T08:00:00Z"),
			makeCommitItem("pr1-commit1", "2024-01-15T10:00:00Z"),
			makeCommitItem("pr1-commit2", "2024-01-15T11:00:00Z"),
			makeCommitItem("pr2-commit1", "2024-01-15T12:00:00Z"),
			makeCommitItem("merge-pr2", "2024-01-15T14:00:00Z"),
		];
		const prs = [
			makePRItem(1, "2024-01-15T13:00:00Z", "user/repo", {
				commit_shas: ["pr1-commit1", "pr1-commit2"],
				merge_commit_sha: null,
			}),
			makePRItem(2, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: ["pr2-commit1"],
				merge_commit_sha: "merge-pr2",
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const commitGroups = result.filter(isCommitGroup);
		const prItems = result.filter(e => e.type === "pull_request") as PRItem[];

		// 2 orphan commits should be in a group
		expect(commitGroups).toHaveLength(1);
		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(2);
			const shas = group.commits.map(c => extractCommitSha(c as TimelineItem));
			expect(shas).toContain("orphan1");
			expect(shas).toContain("orphan2");
		}

		// 2 PRs should be enriched
		expect(prItems).toHaveLength(2);

		const pr1 = prItems.find(p => p.payload.number === 1);
		const pr2 = prItems.find(p => p.payload.number === 2);

		expect(pr1?.payload.commits).toHaveLength(2);
		expect(pr2?.payload.commits).toHaveLength(1);
	});

	it("preserves orphan commits that do not belong to any PR", () => {
		const commits = [makeCommitItem("orphan1", "2024-01-15T10:00:00Z"), makeCommitItem("orphan2", "2024-01-15T11:00:00Z"), makeCommitItem("orphan3", "2024-01-15T12:00:00Z")];
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: ["nonexistent-sha"],
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const commitGroups = result.filter(isCommitGroup);
		expect(commitGroups).toHaveLength(1);

		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(3);
		}
	});

	it("handles empty inputs", () => {
		const result = groupCommits([]);
		expect(result).toHaveLength(0);
	});

	it("handles only PRs with no commits", () => {
		const prs = [
			makePRItem(1, "2024-01-15T15:00:00Z", "user/repo", {
				commit_shas: ["sha1", "sha2"],
			}),
		];

		const result = groupCommits(prs);

		expect(result).toHaveLength(1);
		expect(result[0]?.type).toBe("pull_request");

		// PR should have empty commits array since no matching commits exist
		const pr = result[0] as PRItem;
		expect(pr.payload.commits).toHaveLength(0);
	});

	it("handles PR with both merge_commit_sha and commit_shas", () => {
		const commits = [
			makeCommitItem("feat-commit-1", "2024-01-15T10:00:00Z"),
			makeCommitItem("feat-commit-2", "2024-01-15T11:00:00Z"),
			makeCommitItem("merge-commit", "2024-01-15T12:00:00Z"),
			makeCommitItem("orphan", "2024-01-15T09:00:00Z"),
		];
		const prs = [
			makePRItem(42, "2024-01-15T12:00:00Z", "user/repo", {
				commit_shas: ["feat-commit-1", "feat-commit-2"],
				merge_commit_sha: "merge-commit",
			}),
		];

		const result = groupCommits([...commits, ...prs]);

		const commitGroups = result.filter(isCommitGroup);
		const prItems = result.filter(e => e.type === "pull_request") as PRItem[];

		// Only orphan should remain as standalone
		expect(commitGroups).toHaveLength(1);
		const group = commitGroups[0];
		if (group && isCommitGroup(group)) {
			expect(group.commits).toHaveLength(1);
			expect(extractCommitSha(group.commits[0] as TimelineItem)).toBe("orphan");
		}

		// PR enriched with its feature commits (not merge commit)
		expect(prItems).toHaveLength(1);
		expect(prItems[0]?.payload.commits).toHaveLength(2);
	});

	it("preserves non-commit/non-PR items unchanged", () => {
		const postItem: TimelineItem = {
			id: "post-1",
			platform: "bluesky",
			type: "post",
			timestamp: "2024-01-15T12:00:00Z",
			title: "Hello Bluesky!",
			url: "https://bsky.app/profile/user/post/123",
			payload: {
				type: "post",
				content: "Hello Bluesky!",
				author_handle: "user.bsky.social",
				reply_count: 0,
				repost_count: 5,
				like_count: 10,
				has_media: false,
				is_reply: false,
				is_repost: false,
			},
		};

		const commits = [makeCommitItem("abc123", "2024-01-15T14:00:00Z")];

		const result = groupCommits([...commits, postItem]);

		const posts = result.filter(e => e.type === "post");
		const commitGroups = result.filter(isCommitGroup);

		expect(posts).toHaveLength(1);
		expect(commitGroups).toHaveLength(1);
		expect(posts[0]).toEqual(postItem);
	});
});

describe("groupByDate", () => {
	it("groups items by date", () => {
		const entries: TimelineItem[] = [makeCommitItem("aaa", "2024-01-15T14:00:00Z"), makeCommitItem("bbb", "2024-01-16T10:00:00Z")];

		const grouped = groupCommits(entries);
		const dateGroups = groupByDate(grouped);

		expect(dateGroups).toHaveLength(2);
		expect(dateGroups[0]?.date).toBe("2024-01-16");
		expect(dateGroups[1]?.date).toBe("2024-01-15");
	});

	it("groups items on the same day together", () => {
		const entries: TimelineItem[] = [makeCommitItem("aaa", "2024-01-15T09:00:00Z"), makeCommitItem("bbb", "2024-01-15T14:00:00Z"), makeCommitItem("ccc", "2024-01-15T18:00:00Z")];

		const grouped = groupCommits(entries);
		const dateGroups = groupByDate(grouped);

		expect(dateGroups).toHaveLength(1);
		expect(dateGroups[0]?.date).toBe("2024-01-15");
		expect(dateGroups[0]?.items).toHaveLength(1); // One commit group
	});

	it("handles empty array", () => {
		const dateGroups = groupByDate([]);
		expect(dateGroups).toHaveLength(0);
	});

	it("sorts date groups in descending order", () => {
		const entries: TimelineItem[] = [makeCommitItem("old", "2024-01-10T12:00:00Z"), makeCommitItem("mid", "2024-01-15T12:00:00Z"), makeCommitItem("new", "2024-01-20T12:00:00Z")];

		const grouped = groupCommits(entries);
		const dateGroups = groupByDate(grouped);

		expect(dateGroups[0]?.date).toBe("2024-01-20");
		expect(dateGroups[1]?.date).toBe("2024-01-15");
		expect(dateGroups[2]?.date).toBe("2024-01-10");
	});

	it("handles commit groups correctly", () => {
		const commitGroup: CommitGroup = {
			type: "commit_group",
			repo: "user/repo",
			branch: "main",
			date: "2024-01-15",
			commits: [makeCommitItem("aaa", "2024-01-15T14:00:00Z")],
			total_additions: 10,
			total_deletions: 5,
			total_files_changed: 2,
		};

		const dateGroups = groupByDate([commitGroup]);

		expect(dateGroups).toHaveLength(1);
		expect(dateGroups[0]?.date).toBe("2024-01-15");
		expect(dateGroups[0]?.items).toHaveLength(1);
		expect(dateGroups[0]?.items[0]?.type).toBe("commit_group");
	});

	it("handles mixed timeline entries and commit groups", () => {
		const postItem: TimelineItem = {
			id: "post-1",
			platform: "bluesky",
			type: "post",
			timestamp: "2024-01-15T12:00:00Z",
			title: "A post",
			url: "https://bsky.app/post/1",
			payload: {
				type: "post",
				content: "Hello",
				author_handle: "user",
				reply_count: 0,
				repost_count: 0,
				like_count: 0,
				has_media: false,
				is_reply: false,
				is_repost: false,
			},
		};

		const commitGroup: CommitGroup = {
			type: "commit_group",
			repo: "user/repo",
			branch: "main",
			date: "2024-01-15",
			commits: [makeCommitItem("aaa", "2024-01-15T14:00:00Z")],
			total_additions: 10,
			total_deletions: 5,
			total_files_changed: 2,
		};

		const dateGroups = groupByDate([postItem, commitGroup]);

		expect(dateGroups).toHaveLength(1);
		expect(dateGroups[0]?.items).toHaveLength(2);
	});
});
