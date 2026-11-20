import { afterAll, describe, expect, test } from "bun:test"
import {
  createPost,
  discardDraft,
  editPublishedPost,
  getEditablePost,
  getPost,
  getPostUnread,
  listLatestPosts,
  listNewsFeed,
  listOwnDrafts,
  markPostRead,
  recallPost,
  saveDraft
} from "../../contract/client"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

function paragraph(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
}

describe.skipIf(!database)("News feed and Posts over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  function content(title: string, publish: boolean) {
    return { title, body: paragraph(`${title} body`), publish }
  }

  test("publishes a Post that every member reads in the feed as unread until opened", async () => {
    const author = await h.signedIn({ name: "Author Agnes" })
    const reader = await h.signedIn()
    const title = `Concert ${crypto.randomUUID()}`

    const created = await createPost({ client: author.client, body: content(title, true) })
    expect(created.response?.status).toBe(201)
    const postId = created.data?.id ?? ""

    const feed = await listNewsFeed({ client: reader.client })
    const entry = feed.data?.items.find((item) => item.id === postId)
    expect(feed.data?.permissions).toEqual({ create: true })
    expect(entry).toMatchObject({ title, authorName: "Author Agnes", editedAt: null, unread: true })
    expect(entry?.body).toEqual(paragraph(`${title} body`))
    expect((await getPostUnread({ client: reader.client })).data?.count).toBeGreaterThan(0)

    const opened = await getPost({ client: reader.client, path: { postId } })
    expect(opened.data?.post.title).toBe(title)
    expect(opened.data?.permissions).toEqual({ update: false, unpublish: false })

    const before = (await getPostUnread({ client: reader.client })).data?.count ?? 0
    expect((await markPostRead({ client: reader.client, path: { postId } })).data).toEqual({ changed: true })
    expect((await markPostRead({ client: reader.client, path: { postId } })).data).toEqual({ changed: false })
    expect((await getPostUnread({ client: reader.client })).data?.count).toBe(before - 1)
    const reread = await listNewsFeed({ client: reader.client })
    expect(reread.data?.items.find((item) => item.id === postId)?.unread).toBe(false)

    const latest = await listLatestPosts({ client: reader.client, query: { limit: 1 } })
    expect(latest.data?.items).toEqual([
      { id: postId, title, authorName: "Author Agnes", publishedAt: expect.any(String), editedAt: null }
    ])
  })

  test("keeps a Draft private to its author until they publish it", async () => {
    const author = await h.signedIn()
    const admin = await h.signedIn({ role: "admin" })
    const title = `Draft ${crypto.randomUUID()}`

    const scheduled = h.delivery.scheduled
    const created = await createPost({ client: author.client, body: content(title, false) })
    const postId = created.data?.id ?? ""
    expect(h.delivery.scheduled).toBe(scheduled)

    expect((await listOwnDrafts({ client: author.client })).data?.items.map((draft) => draft.title)).toContain(title)
    expect((await listNewsFeed({ client: author.client })).data?.items.some((item) => item.id === postId)).toBe(false)
    for (const client of [author.client, admin.client]) {
      expect((await getPost({ client, path: { postId } })).response?.status).toBe(404)
    }
    expect((await getEditablePost({ client: admin.client, path: { postId } })).response?.status).toBe(404)
    const adminSave = await saveDraft({ client: admin.client, path: { postId }, body: content("Hijack", true) })
    expect(adminSave.response?.status).toBe(403)

    const editable = await getEditablePost({ client: author.client, path: { postId } })
    expect(editable.data).toMatchObject({ id: postId, title, state: "draft" })

    const published = await saveDraft({ client: author.client, path: { postId }, body: content(title, true) })
    expect(published.data).toEqual({ id: postId })
    expect(h.delivery.scheduled).toBe(scheduled + 1)
    expect((await getPost({ client: admin.client, path: { postId } })).data?.post.title).toBe(title)
  })

  test("lets an Admin edit and recall another author's Post back to that author's drafts", async () => {
    const author = await h.signedIn()
    const admin = await h.signedIn({ role: "admin" })
    const created = await createPost({ client: author.client, body: content("Original", true) })
    const postId = created.data?.id ?? ""

    expect((await getPost({ client: admin.client, path: { postId } })).data?.permissions).toEqual({
      update: true,
      unpublish: true
    })
    const edited = await editPublishedPost({
      client: admin.client,
      path: { postId },
      body: { title: "Corrected", body: paragraph("Corrected body") }
    })
    expect(edited.data).toEqual({ id: postId })
    expect((await getPost({ client: author.client, path: { postId } })).data?.post.editedAt).toEqual(expect.any(String))

    const recalled = await recallPost({ client: admin.client, path: { postId } })
    expect(recalled.data).toEqual({ id: postId, unpublishedTo: "author" })
    expect((await getPost({ client: admin.client, path: { postId } })).response?.status).toBe(404)
    expect((await getEditablePost({ client: admin.client, path: { postId } })).response?.status).toBe(404)
    expect((await listOwnDrafts({ client: author.client })).data?.items.map((draft) => draft.id)).toContain(postId)
    expect((await recallPost({ client: admin.client, path: { postId } })).response?.status).toBe(403)
  })

  test("discards a Draft for good", async () => {
    const author = await h.signedIn()
    const postId = (await createPost({ client: author.client, body: content("Throwaway", false) })).data?.id ?? ""

    expect((await discardDraft({ client: author.client, path: { postId } })).response?.status).toBe(204)
    expect((await listOwnDrafts({ client: author.client })).data?.items.some((draft) => draft.id === postId)).toBe(
      false
    )
    expect((await discardDraft({ client: author.client, path: { postId } })).response?.status).toBe(403)
  })

  test("refuses empty titles and documents the Post schema does not allow", async () => {
    const author = await h.signedIn()

    const emptyTitle = await createPost({ client: author.client, body: { ...content("", true) } })
    const heading = await createPost({
      client: author.client,
      body: {
        title: "Heading",
        body: { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] },
        publish: true
      }
    })

    expect(emptyTitle.response?.status).toBe(400)
    expect(heading.response?.status).toBe(400)
    expect(heading.error).toMatchObject({ code: "VALIDATION_FAILED" })
  })

  test("answers unknown Posts with 404 and signed-out callers with 401", async () => {
    const reader = await h.signedIn()

    expect((await getPost({ client: reader.client, path: { postId: crypto.randomUUID() } })).response?.status).toBe(404)
    expect((await getPost({ client: reader.client, path: { postId: "not-a-post" } })).response?.status).toBe(404)
    expect((await listNewsFeed({ client: h.client() })).response?.status).toBe(401)
    expect((await createPost({ client: h.client(), body: content("Anon", true) })).response?.status).toBe(401)
  })

  test("stops a demoted Admin from changing others' Posts on the next request", async () => {
    const author = await h.signedIn()
    const admin = await h.signedIn({ role: "admin" })
    const postId = (await createPost({ client: author.client, body: content("Kept", true) })).data?.id ?? ""

    await h.setAccount(admin.member.id, { role: "user" })

    expect((await recallPost({ client: admin.client, path: { postId } })).response?.status).toBe(403)
    expect((await getPost({ client: admin.client, path: { postId } })).data?.permissions.unpublish).toBe(false)
  })
})
