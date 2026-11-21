import { newsPostPath } from "@csk-hub/shared/core/navigation/navigation-utils"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useTranslations } from "@/core/i18n/translations"
import { Link } from "@/core/navigation/router"
import { OverviewCard, OverviewList, overviewLinkClassName, overviewRowClassName } from "@/shared/layouts/overview-card"
import { PostByline } from "./post-byline"
import { latestPostsQuery } from "./query"

const LATEST = 3

/** The newest few Posts for an overview page, each by title and byline. */
export function LatestPostsCard({ className }: { className?: string }) {
  const { data: posts } = useSuspenseQuery(latestPostsQuery(LATEST))
  const t = useTranslations("HomePage.news")

  return (
    <OverviewCard
      title={t("title")}
      action={
        <Link href={ROUTES.news} className={overviewLinkClassName}>
          {t("seeAll")}
        </Link>
      }
      className={className}
    >
      {posts.length ? (
        <OverviewList>
          {posts.map((post) => (
            <li key={post.id}>
              <Link href={newsPostPath(post.id)} className={`${overviewRowClassName} flex-col gap-0.5`}>
                <span className="font-medium break-words">{post.title}</span>
                <span className="text-sm text-muted-foreground">
                  <PostByline authorName={post.authorName} publishedAt={post.publishedAt} editedAt={null} />
                </span>
              </Link>
            </li>
          ))}
        </OverviewList>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </OverviewCard>
  )
}
