import type { ReactNode } from "react"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/shared/ui/base/card"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { cn } from "@/shared/utils"

/**
 * One card of an overview page: a heading, an action (usually a link onward to the full page, styled
 * with `overviewLinkClassName`), and a few short rows.
 * Each feature fills its own; this keeps them looking alike. `className` places it in the grid.
 */
export function OverviewCard({
  title,
  action,
  className,
  children
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
        </CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

/** A list of rows inside an `OverviewCard`, each a link of its own. */
export function OverviewList({ children }: { children: ReactNode }) {
  return <ul className="-mx-2 flex flex-col">{children}</ul>
}

export const overviewRowClassName =
  "flex gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"

/** An `OverviewCard` while its data loads. */
export function OverviewCardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <Card size="sm" className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full rounded-xl" />
        ))}
      </CardContent>
    </Card>
  )
}

/** The look of an overview card's onward link. */
export const overviewLinkClassName =
  "text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
