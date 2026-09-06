import { Hono } from "hono";
import type { Env, Variables } from "./types";
import authRoutes from "./routes/auth";
import staffRoutes from "./routes/staff";
import unitsRoutes from "./routes/units";
import reservationsRoutes from "./routes/reservations";
import availabilityRoutes from "./routes/availability";
import tasksRoutes from "./routes/tasks";
import { generateTasksForRange, addDays, todayJST } from "./generateTasks";

// 毎日この日数分先までを自動割り振りの対象にする(Cron Triggerから呼ばれる)。
// スタッフの予定入力・beds24予約の追加/変更を後から拾えるよう、既存の自動割当
// (is_manual_override=0 かつ status=assigned)は毎回再計算される。
const CRON_LOOKAHEAD_DAYS = 30;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.route("/api/auth", authRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/units", unitsRoutes);
app.route("/api/reservations", reservationsRoutes);
app.route("/api/availability", availabilityRoutes);
app.route("/api/tasks", tasksRoutes);

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
});

export default {
  fetch: app.fetch,

  // wrangler.toml の [triggers] crons で設定した時刻に毎日実行される。
  // 今日から CRON_LOOKAHEAD_DAYS 日先までの清掃タスクを自動割り振りする。
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const start = todayJST();
    const end = addDays(start, CRON_LOOKAHEAD_DAYS);
    ctx.waitUntil(
      generateTasksForRange(env.DB, start, end)
        .then((summary) => {
          console.log(`[cron] generated tasks ${start}..${end}:`, JSON.stringify(summary));
        })
        .catch((err) => {
          console.error("[cron] generateTasksForRange failed:", err);
        })
    );
  },
};
