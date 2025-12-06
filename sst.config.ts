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

		const db = new sst.cloudflare.D1("DB");
		const bucket = new sst.cloudflare.Bucket("BUCKET");
		const encryptionKey = new sst.Secret("EncryptionKey");

		const worker = new sst.cloudflare.Worker("Api", {
			handler: "src/index.ts",
			url: true,
			link: [db, bucket, encryptionKey],
			environment: {
				ENVIRONMENT: isProduction ? "production" : "development",
			},
			transform: {
				worker: args => {
					args.scheduledTriggers = [{ cron: "*/5 * * * *" }];
				},
			},
		});

		return {
			api: worker.url,
			databaseId: db.databaseId,
			bucketName: bucket.name,
		};
	},
});
