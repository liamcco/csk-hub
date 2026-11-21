import { HomeScreen } from "@/features/home"
import type { Screen } from "../route-hooks"
import { SettingsPage } from "./signed-in"

export const home: Screen = { component: HomeScreen }
export const settings: Screen = { component: SettingsPage }
