import {
  EditPostScreen,
  EditPostScreenSkeleton,
  NewPostScreen,
  NewsScreen,
  NewsScreenSkeleton,
  PostScreen,
  PostScreenSkeleton
} from "@/features/posts"
import { type Screen, useParam } from "../route-hooks"

export const news: Screen = { component: NewsScreen, pending: NewsScreenSkeleton }
export const newPost: Screen = { component: NewPostScreen }
export const post: Screen = { component: () => <PostScreen postId={useParam("id")} />, pending: PostScreenSkeleton }
export const editPost: Screen = {
  component: () => <EditPostScreen postId={useParam("id")} />,
  pending: EditPostScreenSkeleton
}
