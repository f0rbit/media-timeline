import { eq } from "drizzle-orm";
import type { Database } from "./db";
import { type AccountId, type ProfileId, type UserId, accountId, accounts, profileId, profiles, userId } from "./schema";
import { type Result, err, ok } from "./utils";

export type OwnershipError = {
	status: 404 | 403;
	error: string;
	message: string;
};

export type AccountOwnership = {
	account_id: AccountId;
	profile_id: ProfileId;
	user_id: UserId;
};

export const requireAccountOwnership = async (db: Database, uid: UserId, accId: AccountId): Promise<Result<AccountOwnership, OwnershipError>> => {
	const result = await db
		.select({
			account_id: accounts.id,
			profile_id: accounts.profile_id,
			user_id: profiles.user_id,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(eq(accounts.id, accId))
		.get();

	if (!result) {
		return err({ status: 404, error: "Not found", message: "Account not found" });
	}

	if (result.user_id !== uid) {
		return err({ status: 403, error: "Forbidden", message: "You do not own this account" });
	}

	return ok({
		account_id: accountId(result.account_id),
		profile_id: profileId(result.profile_id),
		user_id: userId(result.user_id),
	});
};
