import { Hono } from "hono";
import { requireAuth } from "../middleware";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const VALID_TYPES = ["3件", "2件", "1件", "✕", "13:30〜"];

// 対象日の1週間前が締切(仕様書 4-3)。締切超過は保存自体は許可し、警告フラグを返すのみ
// (管理者が後から代理入力できるようにするため、ブロックはしない)。
function isPastDeadline(targetDate: string): boolean {
  const deadline = new Date(targetDate + "T00:00:00Z");
  deadline.setUTCDate(deadline.getUTCDate() - 7);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  return todayStr > deadline.toISOString().slice(0, 10);
}

app.get("/", requireAuth, async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  const staffIdParam = c.req.query("staffId");
  if (!start || !end) return c.json({ error: "start, end は必須です" }, 400);

  const session = c.get("session");
  let query = `SELECT id, staff_id, target_date, availability_type, submitted_at
               FROM staff_availability WHERE target_date BETWEEN ? AND ?`;
  const binds: any[] = [start, end];

  if (session.role === "staff") {
    query += " AND staff_id = ?";
    binds.push(session.staffId);
  } else if (staffIdParam) {
    query += " AND staff_id = ?";
    binds.push(Number(staffIdParam));
  }
  query += " ORDER BY target_date, staff_id";

  const { results } = await c.env.DB.prepare(query).bind(...binds).all();
  return c.json(results ?? []);
});

app.post("/", requireAuth, async (c) => {
  const session = c.get("session");
  const body = await c.req.json().catch(() => null);
  const targetDate = body?.targetDate;
  const availabilityType = body?.availabilityType;
  let staffId = body?.staffId;

  if (!targetDate || !availabilityType || !VALID_TYPES.includes(availabilityType)) {
    return c.json({ error: "targetDate, availabilityType(3件/2件/1件/✕/13:30〜) は必須です" }, 400);
  }

  if (session.role === "staff") {
    staffId = session.staffId; // スタッフは自分自身の分のみ登録可能
  } else if (!staffId) {
    return c.json({ error: "管理者が登録する場合は staffId が必須です" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO staff_availability (staff_id, target_date, availability_type, submitted_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(staff_id, target_date) DO UPDATE SET
       availability_type = excluded.availability_type,
       submitted_at = datetime('now')`
  )
    .bind(staffId, targetDate, availabilityType)
    .run();

  return c.json({ ok: true, pastDeadline: isPastDeadline(targetDate) });
});

app.delete("/:id", requireAuth, async (c) => {
  const session = c.get("session");
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT staff_id FROM staff_availability WHERE id = ?")
    .bind(id)
    .first<{ staff_id: number }>();
  if (!row) return c.json({ error: "見つかりません" }, 404);
  if (session.role === "staff" && row.staff_id !== session.staffId) {
    return c.json({ error: "権限がありません" }, 403);
  }
  await c.env.DB.prepare("DELETE FROM staff_availability WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default app;
