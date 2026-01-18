import { type AccountId, type ProfileId, type UserId, accountId, accounts, errors, type ForbiddenError, type NotFoundError, profileId, profiles, userId } from "@media/schema";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import { type Result, ok } from "./utils";

export type OwnershipError = NotFoundError | ForbiddenError;

export type AccountOwnership = {
	account_id: AccountId;
	profile_id: ProfileId;
	user_id: UserId;
};

export type ProfileOwnership = {
	profile_id: ProfileId;
	user_id: UserId;
};

export const requireProfileOwnership = async (db: Database, uid: UserId, profId: ProfileId): Promise<Result<ProfileOwnership, OwnershipError>> => {
	const profile = await db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profId)).get();

	if (!profile) {
		return errors.notFound("profile", profId);
	}

	if (profile.user_id !== uid) {
		return errors.forbidden("You do not own this profile");
	}

	return ok({
		profile_id: profileId(profile.id),
		user_id: userId(profile.user_id),
	});
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
		return errors.notFound("account", accId);
	}

	if (result.user_id !== uid) {
		return errors.forbidden("You do not own this account");
	}

	return ok({
		account_id: accountId(result.account_id),
		profile_id: profileId(result.profile_id),
		user_id: userId(result.user_id),
	});
};
