import "server-only"

import { createRoute, z } from "@hono/zod-openapi"
import type { Context, MiddlewareHandler } from "hono"
import { type ApiEnv, createRouter } from "@/core/http"
import { logger } from "@/core/logging"
import { getMemberIdSession, issueMemberId, type MemberIdContext, MemberIdError, verifyMemberId } from "./service"

const memberIdErrorCodes = ["UNAUTHENTICATED", "FORBIDDEN", "INVALID_CODE", "INVALID_REQUEST", "UNAVAILABLE"] as const

type MemberIdErrorCode = (typeof memberIdErrorCodes)[number]

const MemberIdErrorSchema = z
  .object({
    code: z.enum(memberIdErrorCodes).openapi({ description: "Stable error code. Clients must tolerate unknown codes." })
  })
  .openapi("MemberIdError")

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: MemberIdErrorSchema } } }
}

const unauthenticated = errorResponse("`UNAUTHENTICATED`: no active, signed-in User, including Inactive Users.")
const unavailable = errorResponse("`UNAVAILABLE`: Member ID is temporarily unavailable.")

const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable().openapi({ description: "The User's photo URL, or null when none is set." }),
    accountStatus: z.enum(["active"]),
    choirs: z.array(z.object({ id: z.string(), name: z.string() })).openapi({
      description: "Current Choir affiliations, excluding archived Groups. May be empty."
    })
  })
  .openapi("MemberIdMember")

const MemberIdSessionSchema = z
  .object({
    member: MemberSchema,
    canVerify: z.boolean().openapi({ description: "A UI hint only; verification re-checks authority." })
  })
  .openapi("MemberIdSession")

const getSession = createRoute({
  method: "get",
  path: "/session",
  operationId: "getMemberIdSession",
  summary: "The signed-in User's own Member ID profile and whether they may verify others.",
  tags: ["member-id"],
  responses: {
    200: { description: "The caller's profile.", content: { "application/json": { schema: MemberIdSessionSchema } } },
    401: unauthenticated,
    403: errorResponse("`FORBIDDEN`: the User may not hold a Member ID."),
    503: unavailable
  }
})

const MemberIdCodeSchema = z
  .object({
    token: z.string().openapi({ description: "The opaque QR value. Never put it in a URL, log or storage." }),
    issuedAt: z.number().int().openapi({ description: "Unix milliseconds." }),
    expiresAt: z.number().int().openapi({ description: "Unix milliseconds, exclusive; `issuedAt` + 10,000." }),
    rotateAfterMs: z.number().int().openapi({ description: "Fetch the next code after this many milliseconds." })
  })
  .openapi("MemberIdCode")

const issue = createRoute({
  method: "post",
  path: "/issue",
  operationId: "issueMemberId",
  summary: "Issues a short-lived Member ID code for the caller's own, non-impersonated session.",
  description: "Any request body is ignored.",
  tags: ["member-id"],
  responses: {
    200: { description: "A fresh code.", content: { "application/json": { schema: MemberIdCodeSchema } } },
    401: unauthenticated,
    403: errorResponse("`FORBIDDEN`: the User may not hold a Member ID."),
    503: unavailable
  }
})

const MAX_VERIFY_BODY_BYTES = 4096

const MemberIdVerificationSchema = z
  .object({
    member: MemberSchema,
    verifiedAt: z.number().int().openapi({ description: "Unix milliseconds. A snapshot, not a lasting grant." })
  })
  .openapi("MemberIdVerification")

/**
 * Enforces the frozen verification input rules before the schema validator reads the body: JSON
 * content type (415), a body of at most 4 KiB read as a stream (413) and parseable JSON (400).
 * This runs before authentication, as it always has.
 */
const boundedJsonBody: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!c.req.header("content-type")?.startsWith("application/json")) return memberIdError(c, 415, "INVALID_REQUEST")
  const reader = c.req.raw.body?.getReader()
  if (!reader) return memberIdError(c, 400, "INVALID_REQUEST")
  let text = ""
  let size = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_VERIFY_BODY_BYTES) {
        await reader.cancel()
        return memberIdError(c, 413, "INVALID_REQUEST")
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    JSON.parse(text)
  } catch {
    return memberIdError(c, 400, "INVALID_REQUEST")
  } finally {
    reader.releaseLock()
  }
  // The stream is consumed; give the schema validator the bounded text instead, labelled with the
  // plain JSON type so its stricter media-type check never refuses what this check accepted.
  const headers = new Headers(c.req.raw.headers)
  headers.set("content-type", "application/json")
  c.req.raw = new Request(c.req.raw, { body: text, headers })
  await next()
}

const verify = createRoute({
  method: "post",
  path: "/verify",
  operationId: "verifyMemberId",
  summary: "Admin-only visual verification of a member's current code.",
  description:
    "Rechecks the subject's stored, unexpired, non-impersonated session and active account. " +
    "A missing subject is indistinguishable from an invalid code.",
  tags: ["member-id"],
  middleware: [boundedJsonBody] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ token: z.string().max(2048) }).openapi("MemberIdVerificationRequest")
        }
      }
    }
  },
  responses: {
    200: {
      description: "The verified member.",
      content: { "application/json": { schema: MemberIdVerificationSchema } }
    },
    400: errorResponse(
      "`INVALID_CODE`: expired, forged or revoked code, or an inactive subject. " +
        "`INVALID_REQUEST`: malformed JSON or token."
    ),
    401: unauthenticated,
    403: errorResponse("`FORBIDDEN`: the caller is not an Admin."),
    413: errorResponse("`INVALID_REQUEST`: the body exceeds 4 KiB."),
    415: errorResponse("`INVALID_REQUEST`: the body is not JSON."),
    503: unavailable
  }
})

async function contextOf(c: Context<ApiEnv>): Promise<MemberIdContext> {
  return { request: await c.var.resolveRequest(), database: c.var.database, secret: c.var.secret }
}

function memberIdError(c: Context, status: 400 | 401 | 403 | 413 | 415 | 503, code: MemberIdErrorCode) {
  return c.json({ code }, status)
}

/**
 * Member ID for the iPhone companion, mounted at `/api/member-id`. Its URLs, representations,
 * Unix-millisecond timestamps and error codes predate `/api/v1` and are frozen. Codes travel only
 * in POST bodies and are never logged.
 */
export const memberIdRouter = createRouter()

memberIdRouter.use("*", async (c, next) => {
  await next()
  c.header("Cache-Control", "no-store, private")
  c.header("Pragma", "no-cache")
})

memberIdRouter.openapi(getSession, async (c) => c.json(await getMemberIdSession(await contextOf(c)), 200))
memberIdRouter.openapi(issue, async (c) => c.json(await issueMemberId(await contextOf(c)), 200))
memberIdRouter.openapi(
  verify,
  async (c) => c.json(await verifyMemberId(await contextOf(c), c.req.valid("json").token), 200),
  (result, c) => {
    if (!result.success) return memberIdError(c, 400, "INVALID_REQUEST")
  }
)

memberIdRouter.onError((error, c) => {
  if (error instanceof MemberIdError) {
    const status = ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, INVALID_CODE: 400 } as const)[error.code]
    return memberIdError(c, status, error.code)
  }
  // Do not log the submitted code, session cookies or subject identity.
  logger.error("member_id.request_failed")
  return memberIdError(c, 503, "UNAVAILABLE")
})
