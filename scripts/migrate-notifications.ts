import { runMigration } from "./lib/migration.js";
import { copyIntersection } from "./lib/intersection.js";

await runMigration("notifications-v1", "NOTIFICATION_DATABASE_URL", async context => {
  await copyIntersection(context, "notifications", "auth", "notifications", "notifications", "created_at, id");
});
