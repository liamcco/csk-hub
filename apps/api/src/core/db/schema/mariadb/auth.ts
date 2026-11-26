import { defineRelationsPart } from "drizzle-orm"
import { boolean, index, int, mysqlTable, text } from "drizzle-orm/mysql-core"
import { currentTimestamp, key, timestamp } from "./columns"

// Better Auth's tables, as `../postgres/auth.ts` (which `bun run auth:generate` writes) defines them.
// Change both together.

export const user = mysqlTable("user", {
  id: key("id").primaryKey(),
  name: text("name").notNull(),
  email: key("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
  updatedAt: timestamp("updated_at")
    .default(currentTimestamp)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  username: key("username").unique(),
  displayUsername: text("display_username"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false)
})

export const session = mysqlTable(
  "session",
  {
    id: key("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: key("token").notNull().unique(),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by")
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = mysqlTable(
  "account",
  {
    id: key("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = mysqlTable(
  "verification",
  {
    id: key("id").primaryKey(),
    identifier: key("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at")
      .default(currentTimestamp)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const twoFactor = mysqlTable(
  "two_factor",
  {
    id: key("id").primaryKey(),
    secret: key("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: int("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until")
  },
  (table) => [index("twoFactor_secret_idx").on(table.secret), index("twoFactor_userId_idx").on(table.userId)]
)

export const passkey = mysqlTable(
  "passkey",
  {
    id: key("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: key("credential_id").notNull(),
    counter: int("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid")
  },
  (table) => [index("passkey_userId_idx").on(table.userId), index("passkey_credentialID_idx").on(table.credentialID)]
)

export const authRelations = defineRelationsPart({ user, session, account, verification, twoFactor, passkey }, (r) => ({
  user: {
    sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
    accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
    twoFactors: r.many.twoFactor({ from: r.user.id, to: r.twoFactor.userId }),
    passkeys: r.many.passkey({ from: r.user.id, to: r.passkey.userId })
  },
  session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
  account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) },
  twoFactor: { user: r.one.user({ from: r.twoFactor.userId, to: r.user.id }) },
  passkey: { user: r.one.user({ from: r.passkey.userId, to: r.user.id }) }
}))
