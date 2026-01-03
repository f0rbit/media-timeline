declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type AccountId = Brand<string, "AccountId">;
export type ProfileId = Brand<string, "ProfileId">;
export type ConnectionId = Brand<string, "ConnectionId">;

export const userId = (id: string): UserId => id as UserId;
export const accountId = (id: string): AccountId => id as AccountId;
export const profileId = (id: string): ProfileId => id as ProfileId;
export const connectionId = (id: string): ConnectionId => id as ConnectionId;

export const isValidId = (id: unknown): id is string => typeof id === "string" && id.length > 0;
