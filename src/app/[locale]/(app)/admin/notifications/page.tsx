import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { NotificationManagementScreen } from "@/features/notification-broadcast"

async function AdminNotifications() {
  await requireCapability("admin")
  return <NotificationManagementScreen />
}

export default function AdminNotificationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminNotifications />
    </Suspense>
  )
}
