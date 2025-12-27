# GitHub Commit/PR Fetching Architecture Redesign

## Executive Summary

This document defines the redesigned architecture for fetching and storing GitHub data that:
1. Fetches ALL user repositories (up to 500, excluding forks)
2. Stores commits and PRs in **separate corpus stores per repository**
3. Fetches commits from **all branches** (not just default)
4. Enables efficient timeline building by aggregating from multiple stores

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Store ID pattern | `github/{account_id}/{type}/{owner}/{repo}` | Groups data by account, enables prefix-based discovery |
| Repository limit | 500 repos | Prevents excessive API usage while covering most users |
| Commit/PR limit | 10,000 per repo | Effectively unlimited for practical use, prevents DoS |
| Branch handling | All branches | Captures full development activity |
| Fork handling | Skip forks | Reduces noise, forks are typically read-only |
| Incremental updates | Replace with latest | Corpus versioning preserves history, simpler logic |

---

## Current vs New Architecture

### Current Flow
```
User → GitHub Events API → Single Store (raw/github/{account_id}) → Timeline
```

### New Flow
```
User → GitHub Repos API (up to 500, skip forks)
  │
  ├── Repo1 → Commits API (all branches) → Store (github/{account_id}/commits/{owner}/{repo})
  │         → PRs API                    → Store (github/{account_id}/prs/{owner}/{repo})
  │
  ├── Repo2 → Commits API (all branches) → Store (github/{account_id}/commits/{owner}/{repo})
  │         → PRs API                    → Store (github/{account_id}/prs/{owner}/{repo})
  │
  └── ... (up to 500 repos)
                           ↓
                    Timeline Aggregation (load all stores, dedupe, normalize)
```

---

## 1. Store ID Conventions

```typescript
// Store ID Types
type GitHubCommitsStoreId = `github/${string}/commits/${string}/${string}`;
type GitHubPRsStoreId = `github/${string}/prs/${string}/${string}`;
type GitHubMetaStoreId = `github/${string}/meta`;

// Helper functions
const githubMetaStoreId = (accountId: string) => 
  `github/${accountId}/meta`;

const githubCommitsStoreId = (accountId: string, owner: string, repo: string) => 
  `github/${accountId}/commits/${owner}/${repo}`;

const githubPRsStoreId = (accountId: string, owner: string, repo: string) => 
  `github/${accountId}/prs/${owner}/${repo}`;
```

### Examples
```
github/acc-alice-123/meta
github/acc-alice-123/commits/alice/my-repo
github/acc-alice-123/commits/alice/other-repo
github/acc-alice-123/prs/alice/my-repo
github/acc-alice-123/prs/alice/other-repo
```

### Discovery Patterns
```typescript
// List all commit stores for account
backend.list_stores({ prefix: `github/${accountId}/commits/` })

// List all PR stores for account  
backend.list_stores({ prefix: `github/${accountId}/prs/` })

// List all GitHub stores for account
backend.list_stores({ prefix: `github/${accountId}/` })
```

---

## 2. Schema Definitions

### 2.1 GitHub Repository Meta Schema

```typescript
// src/schema/github-meta.ts
import { z } from "zod";

export const GitHubRepoMetaSchema = z.object({
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),              // "owner/name"
  default_branch: z.string(),
  branches: z.array(z.string()),      // All branch names
  is_private: z.boolean(),
  pushed_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
});

export const GitHubMetaStoreSchema = z.object({
  username: z.string(),
  repositories: z.array(GitHubRepoMetaSchema),
  total_repos_available: z.number(),  // Total before filtering
  repos_fetched: z.number(),          // After fork filtering & limit
  fetched_at: z.string().datetime(),
});

export type GitHubRepoMeta = z.infer<typeof GitHubRepoMetaSchema>;
export type GitHubMetaStore = z.infer<typeof GitHubMetaStoreSchema>;
```

### 2.2 GitHub Repository Commits Schema

```typescript
// src/schema/github-commits.ts
import { z } from "zod";

export const GitHubRepoCommitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author_name: z.string(),
  author_email: z.string(),
  author_date: z.string().datetime(),
  committer_name: z.string(),
  committer_email: z.string(),
  committer_date: z.string().datetime(),
  url: z.string().url(),
  branch: z.string(),                 // Branch this commit was fetched from
  // Optional stats (if available without extra API call)
  additions: z.number().optional(),
  deletions: z.number().optional(),
  files_changed: z.number().optional(),
});

export const GitHubRepoCommitsStoreSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  branches: z.array(z.string()),      // All branches commits were fetched from
  commits: z.array(GitHubRepoCommitSchema),
  total_commits: z.number(),          // Total fetched across all branches
  fetched_at: z.string().datetime(),
});

export type GitHubRepoCommit = z.infer<typeof GitHubRepoCommitSchema>;
export type GitHubRepoCommitsStore = z.infer<typeof GitHubRepoCommitsStoreSchema>;
```

### 2.3 GitHub Repository PRs Schema

```typescript
// src/schema/github-prs.ts
import { z } from "zod";

export const GitHubRepoPRSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed", "merged"]),
  url: z.string().url(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  merged_at: z.string().datetime().nullable(),
  head_ref: z.string(),               // Source branch
  base_ref: z.string(),               // Target branch
  // Commit SHAs only - not full commit data
  commit_shas: z.array(z.string()),
  merge_commit_sha: z.string().nullable(),
  // Author info
  author_login: z.string(),
  author_avatar_url: z.string().url().optional(),
  // Stats
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changed_files: z.number().optional(),
});

export const GitHubRepoPRsStoreSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_requests: z.array(GitHubRepoPRSchema),
  total_prs: z.number(),
  fetched_at: z.string().datetime(),
});

export type GitHubRepoPR = z.infer<typeof GitHubRepoPRSchema>;
export type GitHubRepoPRsStore = z.infer<typeof GitHubRepoPRsStoreSchema>;
```

---

## 3. Provider Implementation

### 3.1 Configuration

```typescript
export type GitHubProviderV2Config = {
  maxRepos: number;           // Default: 500
  maxCommitsPerRepo: number;  // Default: 10000
  maxPRsPerRepo: number;      // Default: 10000
  concurrency: number;        // Default: 5 (parallel repo fetches)
  prCommitConcurrency: number; // Default: 3 (parallel PR commit fetches)
};

const DEFAULT_CONFIG: GitHubProviderV2Config = {
  maxRepos: 500,
  maxCommitsPerRepo: 10000,
  maxPRsPerRepo: 10000,
  concurrency: 5,
  prCommitConcurrency: 3,
};
```

### 3.2 GitHubProviderV2 Class

```typescript
// src/platforms/github-v2.ts
import { Octokit } from "octokit";
import { parallel_map } from "@f0rbit/corpus";
import { ok, err, type Result } from "../utils";
import type { 
  GitHubRepoMeta, 
  GitHubRepoCommitsStore, 
  GitHubRepoPRsStore,
  GitHubMetaStore,
  GitHubRepoCommit,
  GitHubRepoPR,
} from "../schema";
import { toProviderError, type ProviderError } from "./types";

export type GitHubFetchResult = {
  meta: GitHubMetaStore;
  repos: Map<string, {
    commits: GitHubRepoCommitsStore;
    prs: GitHubRepoPRsStore;
  }>;
};

export class GitHubProviderV2 {
  readonly platform = "github";
  private config: GitHubProviderV2Config;

  constructor(config: Partial<GitHubProviderV2Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async fetch(token: string): Promise<Result<GitHubFetchResult, ProviderError>> {
    try {
      const octokit = new Octokit({ auth: token });
      
      // 1. Get authenticated user
      const { data: user } = await octokit.rest.users.getAuthenticated();
      const username = user.login;
      console.log(`[GitHubProviderV2] Authenticated as: ${username}`);

      // 2. Fetch all repos (excluding forks, up to limit)
      const { repos, totalAvailable } = await this.fetchAllRepos(octokit);
      console.log(`[GitHubProviderV2] Found ${repos.length} repos (${totalAvailable} total, forks excluded)`);
      
      // 3. For each repo, fetch branches, commits, and PRs
      const repoData = await this.fetchAllRepoData(octokit, username, repos);

      const meta: GitHubMetaStore = {
        username,
        repositories: repos,
        total_repos_available: totalAvailable,
        repos_fetched: repos.length,
        fetched_at: new Date().toISOString(),
      };

      return ok({ meta, repos: repoData });
    } catch (error) {
      console.error("[GitHubProviderV2] Fetch error:", error);
      return err(this.mapError(error));
    }
  }

  private async fetchAllRepos(octokit: Octokit): Promise<{
    repos: GitHubRepoMeta[];
    totalAvailable: number;
  }> {
    const repos: GitHubRepoMeta[] = [];
    let totalAvailable = 0;
    
    for await (const response of octokit.paginate.iterator(
      octokit.rest.repos.listForAuthenticatedUser,
      { 
        per_page: 100, 
        sort: "pushed", 
        direction: "desc",
        affiliation: "owner,collaborator,organization_member",
      }
    )) {
      for (const repo of response.data) {
        totalAvailable++;
        
        // Skip forks
        if (repo.fork) {
          console.log(`[GitHubProviderV2] Skipping fork: ${repo.full_name}`);
          continue;
        }
        
        repos.push({
          owner: repo.owner.login,
          name: repo.name,
          full_name: repo.full_name,
          default_branch: repo.default_branch,
          branches: [], // Will be populated during commit fetch
          is_private: repo.private,
          pushed_at: repo.pushed_at,
          updated_at: repo.updated_at ?? new Date().toISOString(),
        });
        
        if (repos.length >= this.config.maxRepos) {
          console.log(`[GitHubProviderV2] Reached repo limit: ${this.config.maxRepos}`);
          return { repos, totalAvailable };
        }
      }
    }
    
    return { repos, totalAvailable };
  }

  private async fetchAllRepoData(
    octokit: Octokit,
    username: string,
    repos: GitHubRepoMeta[]
  ): Promise<Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>> {
    const results = new Map<string, { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }>();
    
    await parallel_map(
      repos,
      async (repo) => {
        console.log(`[GitHubProviderV2] Fetching data for: ${repo.full_name}`);
        
        // Fetch branches first
        const branches = await this.fetchBranches(octokit, repo);
        repo.branches = branches;
        
        // Fetch commits and PRs in parallel
        const [commits, prs] = await Promise.all([
          this.fetchRepoCommits(octokit, username, repo, branches),
          this.fetchRepoPRs(octokit, repo),
        ]);
        
        results.set(repo.full_name, { commits, prs });
        console.log(`[GitHubProviderV2] ${repo.full_name}: ${commits.total_commits} commits, ${prs.total_prs} PRs`);
      },
      this.config.concurrency
    );
    
    return results;
  }

  private async fetchBranches(
    octokit: Octokit,
    repo: GitHubRepoMeta
  ): Promise<string[]> {
    const branches: string[] = [];
    
    try {
      for await (const response of octokit.paginate.iterator(
        octokit.rest.repos.listBranches,
        { owner: repo.owner, repo: repo.name, per_page: 100 }
      )) {
        for (const branch of response.data) {
          branches.push(branch.name);
        }
      }
    } catch (error) {
      console.warn(`[GitHubProviderV2] Failed to fetch branches for ${repo.full_name}:`, error);
      // Fallback to default branch
      branches.push(repo.default_branch);
    }
    
    return branches;
  }

  private async fetchRepoCommits(
    octokit: Octokit,
    username: string,
    repo: GitHubRepoMeta,
    branches: string[]
  ): Promise<GitHubRepoCommitsStore> {
    const commits: GitHubRepoCommit[] = [];
    const seenShas = new Set<string>(); // Dedupe across branches
    
    for (const branch of branches) {
      try {
        let fetched = 0;
        
        for await (const response of octokit.paginate.iterator(
          octokit.rest.repos.listCommits,
          {
            owner: repo.owner,
            repo: repo.name,
            author: username,
            sha: branch,
            per_page: 100,
          }
        )) {
          for (const commit of response.data) {
            // Skip if already seen (commit exists on multiple branches)
            if (seenShas.has(commit.sha)) continue;
            seenShas.add(commit.sha);
            
            commits.push({
              sha: commit.sha,
              message: commit.commit.message,
              author_name: commit.commit.author?.name ?? "Unknown",
              author_email: commit.commit.author?.email ?? "",
              author_date: commit.commit.author?.date ?? new Date().toISOString(),
              committer_name: commit.commit.committer?.name ?? "Unknown",
              committer_email: commit.commit.committer?.email ?? "",
              committer_date: commit.commit.committer?.date ?? new Date().toISOString(),
              url: commit.html_url,
              branch,
            });
            
            fetched++;
            if (commits.length >= this.config.maxCommitsPerRepo) {
              console.log(`[GitHubProviderV2] ${repo.full_name}: Hit commit limit`);
              break;
            }
          }
          
          if (commits.length >= this.config.maxCommitsPerRepo) break;
        }
        
        console.log(`[GitHubProviderV2] ${repo.full_name}@${branch}: ${fetched} commits`);
      } catch (error) {
        console.warn(`[GitHubProviderV2] Failed to fetch commits for ${repo.full_name}@${branch}:`, error);
      }
      
      if (commits.length >= this.config.maxCommitsPerRepo) break;
    }
    
    return {
      owner: repo.owner,
      repo: repo.name,
      branches,
      commits,
      total_commits: commits.length,
      fetched_at: new Date().toISOString(),
    };
  }

  private async fetchRepoPRs(
    octokit: Octokit,
    repo: GitHubRepoMeta
  ): Promise<GitHubRepoPRsStore> {
    const pullRequests: GitHubRepoPR[] = [];
    
    try {
      // Fetch all PRs (open, closed, merged)
      for await (const response of octokit.paginate.iterator(
        octokit.rest.pulls.list,
        {
          owner: repo.owner,
          repo: repo.name,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100,
        }
      )) {
        for (const pr of response.data) {
          if (pullRequests.length >= this.config.maxPRsPerRepo) break;
          
          pullRequests.push({
            id: pr.id,
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.merged_at ? "merged" : pr.state === "open" ? "open" : "closed",
            url: pr.html_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            closed_at: pr.closed_at,
            merged_at: pr.merged_at,
            head_ref: pr.head.ref,
            base_ref: pr.base.ref,
            commit_shas: [], // Will be populated below
            merge_commit_sha: pr.merge_commit_sha,
            author_login: pr.user?.login ?? "unknown",
            author_avatar_url: pr.user?.avatar_url,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
          });
        }
        
        if (pullRequests.length >= this.config.maxPRsPerRepo) break;
      }
      
      // Fetch commit SHAs for each PR (in parallel)
      await parallel_map(
        pullRequests,
        async (pr) => {
          try {
            const commitShas: string[] = [];
            
            for await (const response of octokit.paginate.iterator(
              octokit.rest.pulls.listCommits,
              {
                owner: repo.owner,
                repo: repo.name,
                pull_number: pr.number,
                per_page: 100,
              }
            )) {
              for (const commit of response.data) {
                commitShas.push(commit.sha);
              }
            }
            
            pr.commit_shas = commitShas;
          } catch (error) {
            console.warn(`[GitHubProviderV2] Failed to fetch commits for PR #${pr.number}`);
          }
        },
        this.config.prCommitConcurrency
      );
      
    } catch (error) {
      console.warn(`[GitHubProviderV2] Failed to fetch PRs for ${repo.full_name}:`, error);
    }
    
    return {
      owner: repo.owner,
      repo: repo.name,
      pull_requests: pullRequests,
      total_prs: pullRequests.length,
      fetched_at: new Date().toISOString(),
    };
  }

  private mapError(error: unknown): ProviderError {
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status: number }).status;
      const response = (error as { response?: { headers?: Record<string, string | number> } }).response;
      
      if (status === 401 || status === 403) {
        const rateLimitRemaining = response?.headers?.["x-ratelimit-remaining"];
        const rateLimitReset = response?.headers?.["x-ratelimit-reset"];
        
        if (rateLimitRemaining === 0 && rateLimitReset) {
          const resetTime = Math.max(0, Number(rateLimitReset) - Math.floor(Date.now() / 1000));
          return { kind: "rate_limited", retry_after: resetTime };
        }
        return { kind: "auth_expired", message: "GitHub token expired or invalid" };
      }
      
      if (status === 429) {
        const rateLimitReset = response?.headers?.["x-ratelimit-reset"];
        const resetTime = rateLimitReset 
          ? Math.max(0, Number(rateLimitReset) - Math.floor(Date.now() / 1000))
          : 60;
        return { kind: "rate_limited", retry_after: resetTime };
      }
      
      const message = (error as { message?: string }).message ?? "Unknown API error";
      return { kind: "api_error", status, message };
    }
    
    return toProviderError(error);
  }
}
```

### 3.3 Memory Provider for Testing

```typescript
// src/platforms/github-v2-memory.ts
import type { 
  GitHubFetchResult, 
  GitHubRepoMeta,
  GitHubRepoCommitsStore,
  GitHubRepoPRsStore,
  GitHubMetaStore,
} from "../schema";
import { ok, type Result } from "../utils";
import { 
  createMemoryProviderState, 
  simulateErrors, 
  type MemoryProviderState, 
  type MemoryProviderControls 
} from "./memory-base";
import type { ProviderError } from "./types";

export type GitHubV2MemoryConfig = {
  username?: string;
  repositories?: GitHubRepoMeta[];
  repoData?: Map<string, {
    commits: GitHubRepoCommitsStore;
    prs: GitHubRepoPRsStore;
  }>;
};

export class GitHubMemoryProviderV2 implements MemoryProviderControls {
  readonly platform = "github";
  private config: GitHubV2MemoryConfig;
  private state: MemoryProviderState;

  constructor(config: GitHubV2MemoryConfig = {}) {
    this.config = config;
    this.state = createMemoryProviderState();
  }

  async fetch(_token: string): Promise<Result<GitHubFetchResult, ProviderError>> {
    return simulateErrors(this.state, () => {
      const repos = this.config.repositories ?? [];
      const meta: GitHubMetaStore = {
        username: this.config.username ?? "test-user",
        repositories: repos,
        total_repos_available: repos.length,
        repos_fetched: repos.length,
        fetched_at: new Date().toISOString(),
      };
      
      return {
        meta,
        repos: this.config.repoData ?? new Map(),
      };
    });
  }

  // Test helper methods
  setUsername(username: string): void {
    this.config.username = username;
  }

  setRepositories(repos: GitHubRepoMeta[]): void {
    this.config.repositories = repos;
  }

  setRepoData(
    fullName: string, 
    data: { commits: GitHubRepoCommitsStore; prs: GitHubRepoPRsStore }
  ): void {
    if (!this.config.repoData) {
      this.config.repoData = new Map();
    }
    this.config.repoData.set(fullName, data);
  }

  // MemoryProviderControls implementation
  getCallCount = () => this.state.call_count;
  reset = () => { this.state.call_count = 0; };
  setSimulateRateLimit = (value: boolean) => { this.state.simulate_rate_limit = value; };
  setSimulateAuthExpired = (value: boolean) => { this.state.simulate_auth_expired = value; };
}
```

---

## 4. Storage Layer

### 4.1 Store Creation Functions

```typescript
// src/storage.ts (additions)
import { create_corpus, define_store, json_codec, type Backend, type Store } from "@f0rbit/corpus";
import { 
  GitHubRepoCommitsStoreSchema, 
  GitHubRepoPRsStoreSchema,
  GitHubMetaStoreSchema,
  type GitHubRepoCommitsStore,
  type GitHubRepoPRsStore,
  type GitHubMetaStore,
} from "./schema";
import { err, ok, type Result } from "./utils";

// === Store ID Helpers ===

export const githubMetaStoreId = (accountId: string): `github/${string}/meta` => 
  `github/${accountId}/meta`;

export const githubCommitsStoreId = (
  accountId: string, 
  owner: string, 
  repo: string
): `github/${string}/commits/${string}/${string}` => 
  `github/${accountId}/commits/${owner}/${repo}`;

export const githubPRsStoreId = (
  accountId: string, 
  owner: string, 
  repo: string
): `github/${string}/prs/${string}/${string}` => 
  `github/${accountId}/prs/${owner}/${repo}`;

// === Store Creation ===

export function createGitHubMetaStore(
  backend: Backend, 
  accountId: string
): Result<{ store: Store<GitHubMetaStore>; id: string }, CorpusError> {
  const id = githubMetaStoreId(accountId);
  const corpus = create_corpus()
    .with_backend(backend)
    .with_store(define_store(id, json_codec(GitHubMetaStoreSchema)))
    .build();

  const store = corpus.stores[id];
  if (!store) return err({ kind: "store_not_found", store_id: id });
  return ok({ store, id });
}

export function createGitHubCommitsStore(
  backend: Backend,
  accountId: string,
  owner: string,
  repo: string
): Result<{ store: Store<GitHubRepoCommitsStore>; id: string }, CorpusError> {
  const id = githubCommitsStoreId(accountId, owner, repo);
  const corpus = create_corpus()
    .with_backend(backend)
    .with_store(define_store(id, json_codec(GitHubRepoCommitsStoreSchema)))
    .build();

  const store = corpus.stores[id];
  if (!store) return err({ kind: "store_not_found", store_id: id });
  return ok({ store, id });
}

export function createGitHubPRsStore(
  backend: Backend,
  accountId: string,
  owner: string,
  repo: string
): Result<{ store: Store<GitHubRepoPRsStore>; id: string }, CorpusError> {
  const id = githubPRsStoreId(accountId, owner, repo);
  const corpus = create_corpus()
    .with_backend(backend)
    .with_store(define_store(id, json_codec(GitHubRepoPRsStoreSchema)))
    .build();

  const store = corpus.stores[id];
  if (!store) return err({ kind: "store_not_found", store_id: id });
  return ok({ store, id });
}

// === Store Discovery ===

export async function listGitHubCommitStores(
  backend: Backend,
  accountId: string
): Promise<Array<{ owner: string; repo: string; storeId: string }>> {
  const stores: Array<{ owner: string; repo: string; storeId: string }> = [];
  const prefix = `github/${accountId}/commits/`;
  
  for await (const storeId of backend.list_stores({ prefix })) {
    // Parse: github/{accountId}/commits/{owner}/{repo}
    const parts = storeId.split('/');
    if (parts.length >= 5) {
      stores.push({ 
        owner: parts[3]!, 
        repo: parts[4]!, 
        storeId 
      });
    }
  }
  
  return stores;
}

export async function listGitHubPRStores(
  backend: Backend,
  accountId: string
): Promise<Array<{ owner: string; repo: string; storeId: string }>> {
  const stores: Array<{ owner: string; repo: string; storeId: string }> = [];
  const prefix = `github/${accountId}/prs/`;
  
  for await (const storeId of backend.list_stores({ prefix })) {
    const parts = storeId.split('/');
    if (parts.length >= 5) {
      stores.push({ 
        owner: parts[3]!, 
        repo: parts[4]!, 
        storeId 
      });
    }
  }
  
  return stores;
}
```

---

## 5. Cron Job Changes

### 5.1 GitHub-Specific Processing

```typescript
// src/cron-github.ts

import type { Backend } from "@f0rbit/corpus";
import { GitHubProviderV2, type GitHubFetchResult } from "./platforms/github-v2";
import { 
  createGitHubMetaStore, 
  createGitHubCommitsStore, 
  createGitHubPRsStore,
  githubCommitsStoreId,
  githubPRsStoreId,
} from "./storage";
import { ok, err, type Result } from "./utils";

export type GitHubProcessResult = {
  account_id: string;
  meta_version: string;
  commit_stores: Array<{ owner: string; repo: string; version: string }>;
  pr_stores: Array<{ owner: string; repo: string; version: string }>;
  stats: {
    repos_processed: number;
    total_commits: number;
    total_prs: number;
  };
};

type ProcessError = 
  | { kind: "fetch_failed"; message: string }
  | { kind: "store_failed"; store_id: string };

export async function processGitHubAccount(
  backend: Backend,
  accountId: string,
  token: string
): Promise<Result<GitHubProcessResult, ProcessError>> {
  console.log(`[processGitHubAccount] Starting for account: ${accountId}`);
  
  const provider = new GitHubProviderV2({
    maxRepos: 500,
    maxCommitsPerRepo: 10000,
    maxPRsPerRepo: 10000,
    concurrency: 5,
  });
  
  // Fetch all data
  const fetchResult = await provider.fetch(token);
  if (!fetchResult.ok) {
    return err({ 
      kind: "fetch_failed", 
      message: `GitHub fetch failed: ${fetchResult.error.kind}` 
    });
  }
  
  const { meta, repos } = fetchResult.value;
  
  // Store meta
  let metaVersion = "";
  const metaStoreResult = createGitHubMetaStore(backend, accountId);
  if (metaStoreResult.ok) {
    const putResult = await metaStoreResult.value.store.put(meta);
    if (putResult.ok) {
      metaVersion = putResult.value.version;
    }
  }
  
  // Store commits and PRs for each repo
  const commitStores: Array<{ owner: string; repo: string; version: string }> = [];
  const prStores: Array<{ owner: string; repo: string; version: string }> = [];
  let totalCommits = 0;
  let totalPRs = 0;
  
  for (const [fullName, data] of repos) {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) continue;
    
    // Store commits
    const commitsStoreResult = createGitHubCommitsStore(backend, accountId, owner, repo);
    if (commitsStoreResult.ok) {
      const putResult = await commitsStoreResult.value.store.put(data.commits);
      if (putResult.ok) {
        commitStores.push({ owner, repo, version: putResult.value.version });
        totalCommits += data.commits.total_commits;
      }
    }
    
    // Store PRs
    const prsStoreResult = createGitHubPRsStore(backend, accountId, owner, repo);
    if (prsStoreResult.ok) {
      const putResult = await prsStoreResult.value.store.put(data.prs);
      if (putResult.ok) {
        prStores.push({ owner, repo, version: putResult.value.version });
        totalPRs += data.prs.total_prs;
      }
    }
  }
  
  console.log(`[processGitHubAccount] Completed:`, {
    repos: repos.size,
    commitStores: commitStores.length,
    prStores: prStores.length,
    totalCommits,
    totalPRs,
  });
  
  return ok({
    account_id: accountId,
    meta_version: metaVersion,
    commit_stores: commitStores,
    pr_stores: prStores,
    stats: {
      repos_processed: repos.size,
      total_commits: totalCommits,
      total_prs: totalPRs,
    },
  });
}
```

### 5.2 Integration with Main Cron

```typescript
// src/cron.ts (modifications to processAccount)

const processAccount = async (
  ctx: AppContext, 
  account: AccountWithUser
): Promise<RawSnapshot | null> => {
  // ... existing rate limit checks ...
  
  const tokenResult = decrypt(account.access_token_encrypted, ctx.encryptionKey);
  if (!tokenResult.ok) return null;
  const token = tokenResult.value;
  
  // Special handling for GitHub with new multi-store architecture
  if (account.platform === "github") {
    const result = await processGitHubAccount(ctx.backend, account.id, token);
    
    if (!result.ok) {
      await recordFailure(ctx.db, account.id);
      console.error(`[processAccount] GitHub processing failed: ${result.error.message}`);
      return null;
    }
    
    await recordSuccess(ctx.db, account.id);
    
    // Return synthetic snapshot that references individual stores
    return {
      account_id: account.id,
      platform: "github",
      version: result.value.meta_version,
      data: {
        type: "github_multi_store",
        commit_stores: result.value.commit_stores,
        pr_stores: result.value.pr_stores,
        stats: result.value.stats,
      },
    };
  }
  
  // ... existing flow for other platforms ...
};
```

---

## 6. Timeline Building

### 6.1 Loading GitHub Data from Multiple Stores

```typescript
// src/timeline-github.ts

import type { Backend } from "@f0rbit/corpus";
import { 
  listGitHubCommitStores, 
  listGitHubPRStores,
  createGitHubCommitsStore,
  createGitHubPRsStore,
} from "./storage";
import type { 
  GitHubRepoCommit, 
  GitHubRepoPR,
  TimelineItem,
  CommitPayload,
  PullRequestPayload,
} from "./schema";
import { to_nullable } from "./utils";

// Extended types with repo context
type CommitWithRepo = GitHubRepoCommit & { _repo: string };
type PRWithRepo = GitHubRepoPR & { _repo: string };

type GitHubTimelineData = {
  commits: CommitWithRepo[];
  prs: PRWithRepo[];
};

/**
 * Load all GitHub commits and PRs for an account from multiple stores
 */
export async function loadGitHubDataForAccount(
  backend: Backend,
  accountId: string
): Promise<GitHubTimelineData> {
  const commits: CommitWithRepo[] = [];
  const prs: PRWithRepo[] = [];
  
  // Load commits from all repos in parallel
  const commitStores = await listGitHubCommitStores(backend, accountId);
  
  await Promise.all(
    commitStores.map(async ({ owner, repo }) => {
      const storeResult = createGitHubCommitsStore(backend, accountId, owner, repo);
      if (!storeResult.ok) return;
      
      const snapshot = to_nullable(await storeResult.value.store.get_latest());
      if (!snapshot) return;
      
      const fullName = `${owner}/${repo}`;
      for (const commit of snapshot.data.commits) {
        commits.push({ ...commit, _repo: fullName });
      }
    })
  );
  
  // Load PRs from all repos in parallel
  const prStores = await listGitHubPRStores(backend, accountId);
  
  await Promise.all(
    prStores.map(async ({ owner, repo }) => {
      const storeResult = createGitHubPRsStore(backend, accountId, owner, repo);
      if (!storeResult.ok) return;
      
      const snapshot = to_nullable(await storeResult.value.store.get_latest());
      if (!snapshot) return;
      
      const fullName = `${owner}/${repo}`;
      for (const pr of snapshot.data.pull_requests) {
        prs.push({ ...pr, _repo: fullName });
      }
    })
  );
  
  console.log(`[loadGitHubDataForAccount] Loaded: ${commits.length} commits, ${prs.length} PRs`);
  return { commits, prs };
}

/**
 * Normalize GitHub data into timeline items with PR-commit deduplication
 */
export function normalizeGitHubV2(data: GitHubTimelineData): TimelineItem[] {
  const items: TimelineItem[] = [];
  
  // Build set of all commit SHAs that belong to PRs
  const prCommitShas = new Set<string>();
  for (const pr of data.prs) {
    for (const sha of pr.commit_shas) {
      prCommitShas.add(sha);
    }
    if (pr.merge_commit_sha) {
      prCommitShas.add(pr.merge_commit_sha);
    }
  }
  
  console.log(`[normalizeGitHubV2] PR commit SHAs to exclude: ${prCommitShas.size}`);
  
  // Add commits (excluding those that belong to PRs)
  let orphanCommits = 0;
  let dedupedCommits = 0;
  
  for (const commit of data.commits) {
    if (prCommitShas.has(commit.sha)) {
      dedupedCommits++;
      continue;
    }
    
    orphanCommits++;
    const payload: CommitPayload = {
      type: "commit",
      sha: commit.sha,
      message: commit.message,
      repo: commit._repo,
      branch: commit.branch,
      additions: commit.additions,
      deletions: commit.deletions,
      files_changed: commit.files_changed,
    };
    
    items.push({
      id: `github:commit:${commit._repo}:${commit.sha.slice(0, 7)}`,
      platform: "github",
      type: "commit",
      timestamp: commit.author_date,
      title: truncateMessage(commit.message),
      url: commit.url,
      payload,
    });
  }
  
  console.log(`[normalizeGitHubV2] Commits: ${orphanCommits} orphan, ${dedupedCommits} deduped`);
  
  // Add PRs with commit SHA references
  for (const pr of data.prs) {
    const payload: PullRequestPayload & { commit_shas: string[]; merge_commit_sha: string | null } = {
      type: "pull_request",
      repo: pr._repo,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      action: pr.state,
      head_ref: pr.head_ref,
      base_ref: pr.base_ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
      commits: [], // Enriched later if needed
      commit_shas: pr.commit_shas,
      merge_commit_sha: pr.merge_commit_sha,
    };
    
    items.push({
      id: `github:pr:${pr._repo}:${pr.number}`,
      platform: "github",
      type: "pull_request",
      timestamp: pr.merged_at ?? pr.updated_at,
      title: pr.title,
      url: pr.url,
      payload,
    });
  }
  
  console.log(`[normalizeGitHubV2] Total timeline items: ${items.length}`);
  return items;
}

// Helper
const truncateMessage = (message: string): string => {
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};
```

### 6.2 Updated combineUserTimeline

```typescript
// src/cron.ts (updated combineUserTimeline)

import { loadGitHubDataForAccount, normalizeGitHubV2 } from "./timeline-github";
import { 
  githubCommitsStoreId, 
  githubPRsStoreId,
  rawStoreId,
  createTimelineStore,
} from "./storage";

const combineUserTimeline = async (
  backend: Backend, 
  userId: string, 
  snapshots: RawSnapshot[]
): Promise<void> => {
  console.log(`[combineUserTimeline] Starting for user: ${userId}`);
  
  const items: TimelineItem[] = [];
  const parents: Array<{ store_id: string; version: string; role: "source" }> = [];
  
  for (const snapshot of snapshots) {
    if (snapshot.platform === "github") {
      // Handle new multi-store GitHub format
      const data = snapshot.data as { 
        type?: string; 
        commit_stores?: Array<{ owner: string; repo: string; version: string }>;
        pr_stores?: Array<{ owner: string; repo: string; version: string }>;
      };
      
      if (data.type === "github_multi_store") {
        // Load from individual stores
        const githubData = await loadGitHubDataForAccount(backend, snapshot.account_id);
        items.push(...normalizeGitHubV2(githubData));
        
        // Add all stores as parents for lineage tracking
        for (const s of data.commit_stores ?? []) {
          parents.push({
            store_id: githubCommitsStoreId(snapshot.account_id, s.owner, s.repo),
            version: s.version,
            role: "source",
          });
        }
        for (const s of data.pr_stores ?? []) {
          parents.push({
            store_id: githubPRsStoreId(snapshot.account_id, s.owner, s.repo),
            version: s.version,
            role: "source",
          });
        }
      } else {
        // Legacy format - use old normalizer
        const normalizeResult = normalizeSnapshot(snapshot);
        if (normalizeResult.ok) {
          items.push(...normalizeResult.value);
        }
        parents.push({
          store_id: rawStoreId(snapshot.platform, snapshot.account_id),
          version: snapshot.version,
          role: "source",
        });
      }
    } else {
      // Other platforms - existing flow
      const normalizeResult = normalizeSnapshot(snapshot);
      if (normalizeResult.ok) {
        items.push(...normalizeResult.value);
      }
      parents.push({
        store_id: rawStoreId(snapshot.platform, snapshot.account_id),
        version: snapshot.version,
        role: "source",
      });
    }
  }
  
  console.log(`[combineUserTimeline] Total items: ${items.length}, parents: ${parents.length}`);
  
  // Group commits and build date groups
  const entries = groupCommits(items);
  const dateGroups = groupByDate(entries);
  
  const timeline = {
    user_id: userId,
    generated_at: new Date().toISOString(),
    groups: dateGroups,
  };
  
  // Store timeline
  const timelineStoreResult = createTimelineStore(backend, userId);
  if (timelineStoreResult.ok) {
    await timelineStoreResult.value.store.put(timeline, { parents });
    console.log(`[combineUserTimeline] Timeline stored for user: ${userId}`);
  }
};
```

---

## 7. Migration

Since this is not in production, migration is straightforward:

### Option A: Delete and Re-fetch (Recommended)
```bash
# Clear all existing GitHub raw stores
# Next cron run will populate new stores
```

### Option B: Migration Script
```typescript
// scripts/migrate-github-stores.ts
async function migrateGitHubStores(backend: Backend) {
  // Find all old-style stores
  const oldStores: string[] = [];
  for await (const storeId of backend.list_stores({ prefix: "raw/github/" })) {
    oldStores.push(storeId);
  }
  
  console.log(`Found ${oldStores.length} old GitHub stores to delete`);
  
  // Delete them
  for (const storeId of oldStores) {
    await backend.delete_store(storeId);
    console.log(`Deleted: ${storeId}`);
  }
  
  console.log("Migration complete. Run cron to populate new stores.");
}
```

---

## 8. Performance Considerations

### API Rate Limits
- GitHub API: 5,000 requests/hour for authenticated users
- Fetching 500 repos with commits + PRs + PR commits could use ~2,000-3,000 requests
- Mitigation: Concurrency limits, pagination, caching

### Estimated API Calls per Account
| Operation | Calls per Repo | Max Repos | Total |
|-----------|---------------|-----------|-------|
| List repos | 5 (paginated) | - | 5 |
| List branches | 1-3 | 500 | 500-1,500 |
| List commits | 1-100 | 500 | 500-50,000 |
| List PRs | 1-100 | 500 | 500-50,000 |
| List PR commits | 1 per PR | varies | varies |

**Recommendation**: Add rate limit awareness and back-off

### Storage Growth
- ~1KB per commit, ~2KB per PR
- 500 repos × 100 commits = 50MB per account (reasonable)
- Corpus handles versioning efficiently

---

## 9. File Structure

```
src/
├── schema/
│   ├── github-meta.ts      (NEW)
│   ├── github-commits.ts   (NEW)
│   ├── github-prs.ts       (NEW)
│   └── index.ts            (updated exports)
├── platforms/
│   ├── github-v2.ts        (NEW)
│   ├── github-v2-memory.ts (NEW)
│   └── index.ts            (updated exports)
├── storage.ts              (additions)
├── cron.ts                 (modifications)
├── cron-github.ts          (NEW)
└── timeline-github.ts      (NEW)
```

---

## 10. Testing Strategy

### Unit Tests
- Schema validation for new types
- Store ID generation functions
- Commit-PR deduplication logic

### Integration Tests
- Full cron flow with memory provider
- Multi-repo aggregation
- Timeline building with mixed platforms

### Test Fixtures
```typescript
// New fixtures for testing
export const GITHUB_V2_FIXTURES = {
  singleRepoWithCommits: () => ({
    meta: { ... },
    repos: new Map([
      ["alice/repo", {
        commits: makeCommitsStore("alice", "repo", 5),
        prs: makePRsStore("alice", "repo", 2),
      }],
    ]),
  }),
  
  multipleRepos: () => ({ ... }),
  
  repoWithPRCommitOverlap: () => ({ ... }),
};
```

---

## 11. Rollout Plan

1. **Phase 1**: Implement schemas and storage (no behavior change)
2. **Phase 2**: Implement GitHubProviderV2 alongside existing provider
3. **Phase 3**: Add feature flag to switch between providers
4. **Phase 4**: Migrate cron to use new provider
5. **Phase 5**: Update timeline building
6. **Phase 6**: Remove old provider and legacy code

---

## Appendix: Type Summary

```typescript
// Store IDs
type GitHubMetaStoreId = `github/${string}/meta`;
type GitHubCommitsStoreId = `github/${string}/commits/${string}/${string}`;
type GitHubPRsStoreId = `github/${string}/prs/${string}/${string}`;

// Data Structures
type GitHubRepoMeta = { owner, name, full_name, default_branch, branches, is_private, pushed_at, updated_at };
type GitHubMetaStore = { username, repositories, total_repos_available, repos_fetched, fetched_at };
type GitHubRepoCommit = { sha, message, author_*, committer_*, url, branch, additions?, deletions?, files_changed? };
type GitHubRepoCommitsStore = { owner, repo, branches, commits, total_commits, fetched_at };
type GitHubRepoPR = { id, number, title, body, state, url, dates, refs, commit_shas, merge_commit_sha, author_*, stats? };
type GitHubRepoPRsStore = { owner, repo, pull_requests, total_prs, fetched_at };

// Provider Result
type GitHubFetchResult = { meta: GitHubMetaStore, repos: Map<string, { commits, prs }> };

// Process Result  
type GitHubProcessResult = { account_id, meta_version, commit_stores, pr_stores, stats };
```
