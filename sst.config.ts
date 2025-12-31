/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "media-timeline",
			removal: input?.stage === "production" ? "retain" : "remove",
			protect: input?.stage === "production",
			home: "cloudflare",
		};
	},
	async run() {
		const isProduction = $app.stage === "production";

		const apiUrl = isProduction ? "https://media.devpad.tools" : "http://localhost:8787";
		const frontendUrl = isProduction ? "https://media.devpad.tools" : "http://localhost:4321";

		const db = new sst.cloudflare.D1("DB");
		const bucket = new sst.cloudflare.Bucket("BUCKET");
		const encryptionKey = new sst.Secret("EncryptionKey");

		const redditClientId = new sst.Secret("RedditClientId");
		const redditClientSecret = new sst.Secret("RedditClientSecret");
		const twitterClientId = new sst.Secret("TwitterClientId");
		const twitterClientSecret = new sst.Secret("TwitterClientSecret");
		const gitHubClientId = new sst.Secret("GitHubClientId");
		const gitHubClientSecret = new sst.Secret("GitHubClientSecret");

		const worker = new sst.cloudflare.Worker("Api", {
			handler: "src/index.ts",
			url: true,
			link: [db, bucket, encryptionKey, redditClientId, redditClientSecret, twitterClientId, twitterClientSecret, gitHubClientId, gitHubClientSecret],
			environment: {
				ENVIRONMENT: isProduction ? "production" : "development",
				MEDIA_API_URL: apiUrl,
				MEDIA_FRONTEND_URL: frontendUrl,
			},
			transform: {
				worker: args => {
					args.scheduledTriggers = [{ cron: "*/5 * * * *" }];
				},
			},
		});

		const website = new sst.cloudflare.Astro("Website", {
			path: "apps/website",
			environment: {
				PUBLIC_API_URL: apiUrl,
				PUBLIC_DEVPAD_URL: "https://devpad.tools",
			},
			domain: isProduction ? "media.devpad.tools" : undefined,
		});

		return {
			api: worker.url,
			website: website.url,
			databaseId: db.databaseId,
			bucketName: bucket.name,
		};
	},
});
