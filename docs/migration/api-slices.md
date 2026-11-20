# Moving web workflows onto the HTTP API

Tracks liamcco/csk-hub#4: every existing web workflow reaches authoritative behaviour through
the Hono API (`/api/v1`) and the generated client, one reviewable slice at a time. The inventory
comes from the fork baseline (`bdb47e4`): 20 Server Action files, server-component reads in the
feature screens and the app shell.

How a slice lands:

1. A feature router (`src/features/<name>/http`) mounted in `src/api/app.ts`, documented with
   `errorResponses` and stable codes (ADR 0009 draft).
2. HTTP tests in `src/api/<name>.test.ts` through the generated client on a disposable
   PostgreSQL database (`test/api.ts` harness): success, denial, and authority changes that apply
   to the next request.
3. Screens read through `getServerApiClient()` / `readForScreen()` and write through
   `browserApiClient` (`src/core/api-client`). Server Actions are removed, or kept only as thin
   adapters over the API.
4. Playwright journeys in `e2e/*.e2e.ts` (`bun --env-file=.env run e2e`) against `next dev` on a
   disposable database, or a recorded gap below.
5. `bun run api:generate` and the contract test stay clean.

Cross-cutting rules every slice keeps: `/api/v1` responses are `private, no-store`; unsafe
methods need the Hub `Origin` (cookie-authenticated CSRF guard); permissions in responses are UI
hints for the current User and every operation re-resolves the actor; post-commit delivery stays
behind `scheduleActivityDispatch()` (see "Delivery boundary").

## Slices

| # | Slice | API | HTTP tests | Web on API | Journey | Status |
| - | ----- | --- | ---------- | ---------- | ------- | ------ |
| 0 | Web API client, Origin guard, Playwright harness | `core/api-client`, `src/api/app.ts` | `members.test.ts` (Origin) | — | `e2e/run.ts` | done |
| 1 | Member directory, profile, profile edit | `listMembers`, `getMemberProfile`, `getOwnProfile`, `getProfileEditor`, `updateProfileVoices` | `members.test.ts` | `/members`, `/members/[id]`, `/me`, `/me/edit` | `members.e2e.ts` | done |
| 2 | App shell: capabilities, unread badges | | | | | todo |
| 3 | News feed, Posts, Drafts, recall, unread | | | | | todo |
| 4 | Home (upcoming Events, latest News) | | | | | todo |
| 5 | Direct and Group Conversations, Messages, unread | | | | | todo |
| 6 | Events and Locations | | | | | todo |
| 7 | Account settings: locale, push subscriptions | | | | | todo |
| 8 | User administration | | | | | todo |
| 9 | Groups, Memberships, Positions | | | | | todo |
| 10 | Admin broadcasts | | | | | todo |

## Baseline inventory

| Feature | Reads | Writes (Server Actions) |
| ------- | ----- | ----------------------- |
| members | `getDirectory`, `getProfile`, `getProfileEditor` | `saveProfileAction` |
| home | session greeting, `listCurrentUpcomingEvents`, `listLatestPosts` | — |
| posts | `listNewsFeed`, `listOwnDrafts`, `getPublishedPost`, `getEditablePost`, unread ids/count/expiry | `createPost`, `saveDraft`, `editPublishedPost`, `unpublishPost`, `discardDraft`, `markPostReadAction` |
| messaging | `listConversations`, `getConversationPage`, `findDirectConversation`, unread count | `sendMessageAction`, `markConversationReadAction`, `groupConversationAction`, `searchMembersAction`, `startConversationAction` |
| events | upcoming, event page, managed list, editor options, Locations, capabilities | `create/update/changeStatus/deleteEventAction`, `create/update/archiveLocationAction` |
| account | session, settings gate, push binding | `activateAccount`, `updateLocalePreference`, `subscribe/unsubscribeUserToPush`, `sendPushNotificationTest`, `revokePushBindingBeforeLogout` |
| user-management | `listUsers` | `activate/deactivate/eraseUser`, `resendInvitation`, `changeUserRole`, `addUser`, `findExistingUserEmails`, `importUsers` |
| org-structure | choir placement, groups overview, Position catalogue, Group detail | `create/rename/archiveGroupAction`, `addMember/endMembership/changeVoice/assignHolder/endHoldingAction`, `create/updatePositionAction` |
| notification-broadcast | recipient search | `sendTestNotificationToAll`, `sendTestNotificationToUsers` |
| app shell | nav capabilities (`can`), unread badges, admin page gates | — |

Login, two-factor, passkeys, password reset, sessions and email verification stay on Better
Auth's `/api/auth` (ADR 0008 draft) and are not part of this migration.

## Delivery boundary

Writes that queue outbox rows do so inside their own transaction (`queueActivity`,
`queuePublicActivity`). After the transaction commits, routes call `scheduleActivityDispatch()`,
the single explicit boundary that today runs dispatch through Next.js `after()`. Admin broadcasts
keep their own path: `push: false` outbox rows plus direct Web Push.

## Gaps

- None yet.
