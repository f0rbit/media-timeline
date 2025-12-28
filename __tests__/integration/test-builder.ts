/**
 * Test Builder - Reduces test setup boilerplate.
 *
 * @example
 * const ctx = await testBuilder()
 *   .withUser(USERS.alice)
 *   .withAccount(USERS.alice.id, ACCOUNTS.alice_github)
 *   .build();
 *
 * // Or use convenience methods:
 * const ctx = await testBuilder()
 *   .withAliceGitHub()
 *   .withAliceReddit()
 *   .build();
 */

import { ACCOUNTS, USERS } from "./fixtures";
import { type AccountSeed, type TestContext, type UserSeed, createTestContext, seedAccount, seedUser } from "./setup";

export class TestBuilder {
	private userSeeds: UserSeed[] = [];
	private accountSeeds: Array<{ userId: string; account: AccountSeed }> = [];
	private providerSetups: Array<() => void> = [];
	private _ctx: TestContext | null = null;

	/**
	 * Add a user to the test context.
	 */
	withUser(user: UserSeed): this {
		this.userSeeds.push(user);
		return this;
	}

	/**
	 * Add an account for a user.
	 */
	withAccount(userId: string, account: AccountSeed): this {
		this.accountSeeds.push({ userId, account });
		return this;
	}

	/**
	 * Add Alice with her GitHub account (common setup).
	 */
	withAliceGitHub(): this {
		return this.withUser(USERS.alice).withAccount(USERS.alice.id, ACCOUNTS.alice_github);
	}

	/**
	 * Add Alice with her Reddit account.
	 */
	withAliceReddit(): this {
		return this.withUser(USERS.alice).withAccount(USERS.alice.id, ACCOUNTS.alice_reddit);
	}

	/**
	 * Add Alice with her Twitter account.
	 */
	withAliceTwitter(): this {
		return this.withUser(USERS.alice).withAccount(USERS.alice.id, ACCOUNTS.alice_twitter);
	}

	/**
	 * Add Alice with her Bluesky account.
	 */
	withAliceBluesky(): this {
		return this.withUser(USERS.alice).withAccount(USERS.alice.id, ACCOUNTS.alice_bluesky);
	}

	/**
	 * Add Bob with his GitHub account.
	 */
	withBobGitHub(): this {
		return this.withUser(USERS.bob).withAccount(USERS.bob.id, ACCOUNTS.bob_github);
	}

	/**
	 * Add Bob with his YouTube account.
	 */
	withBobYouTube(): this {
		return this.withUser(USERS.bob).withAccount(USERS.bob.id, ACCOUNTS.bob_youtube);
	}

	/**
	 * Add Bob with his Reddit account.
	 */
	withBobReddit(): this {
		return this.withUser(USERS.bob).withAccount(USERS.bob.id, ACCOUNTS.bob_reddit);
	}

	/**
	 * Build the test context, seeding all configured data.
	 */
	async build(): Promise<TestContext> {
		this._ctx = createTestContext();

		const seenUsers = new Set<string>();
		for (const user of this.userSeeds) {
			if (seenUsers.has(user.id)) continue;
			await seedUser(this._ctx, user);
			seenUsers.add(user.id);
		}

		for (const { userId, account } of this.accountSeeds) {
			await seedAccount(this._ctx, userId, account);
		}

		for (const setup of this.providerSetups) {
			setup();
		}

		return this._ctx;
	}

	/**
	 * Get the built context (throws if not built yet).
	 */
	get ctx(): TestContext {
		if (!this._ctx) throw new Error("TestBuilder.build() must be called first");
		return this._ctx;
	}
}

/**
 * Convenience function to create a new test builder.
 */
export const testBuilder = () => new TestBuilder();
