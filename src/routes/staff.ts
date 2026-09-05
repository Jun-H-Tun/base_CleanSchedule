import { Hono } from "hono";
import { requireAuth, requireAdmin } from "../middleware";
import { hashPassword } from "../auth";
import type { Env, Variables, StaffRow } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.is_external, s.priority_order, s.color_code, s.created_at,
            u.id as user_id, u.username
     FROM staff s LEFT JOIN users u ON u.staff_id = s.id
     ORDER BY s.is_external ASC, s.priority_order ASC`
  ).all();
  return c.json(results ?? []);
});

app.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "スタッフ名は必須です" }, 400);
  const isExternal = body?.isExternal ? 1 : 0;
  const priorityOrder = typeof body?.priorityOrder === "number" ? body.priorityOrder : null;
  const colorCode = body?.colorCode ?? null;

  const result = await c.env.DB.prepare(
    `INSERT INTO staff (name, is_external, priority_order, color_code) VALUES (?, ?, ?, ?)`
  )
    .bind(name, isExternal, priorityOrder, colorCode)
    .run();
  const staffId = result.meta.last_row_id;

  if (body?.username && body?.password) {
    const passwordHash = await hashPassword(body.password);
    await c.env.DB.prepare(
      `INSERT INTO users (staff_id, username, password_hash, role) VALUES (?, ?, ?, 'staff')`
    )
      .bind(staffId, body.username, passwordHash)
      .run();
  }

  return c.json({ id: staffId }, 201);
});

app.put("/:id", requireAuth, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "不正なリクエストです" }, 400);

  const existing = await c.env.DB.prepare("SELECT * FROM staff WHERE id = ?").bind(id).first<StaffRow>();
  if (!existing) return c.json({ error: "スタッフが見つかりません" }, 404);

  await c.env.DB.prepare(
    `UPDATE staff SET name = ?, is_external = ?, priority_order = ?, color_code = ? WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.isExternal !== undefined ? (body.isExternal ? 1 : 0) : existing.is_external,
      body.priorityOrder !== undefined ? body.priorityOrder : existing.priority_order,
      body.colorCode !== undefined ? body.colorCode : existing.color_code,
      id
    )
    .run();

  return c.json({ ok: true });
});

app.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const inUse = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM cleaning_tasks WHERE assigned_staff_id = ?"
  )
    .bind(id)
    .first<{ cnt: number }>();
  if (inUse && inUse.cnt > 0) {
    return c.json({ error: "このスタッフには清掃タスクの割り当て履歴があるため削除できません" }, 409);
  }
  await c.env.DB.prepare("DELETE FROM users WHERE staff_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM staff_availability WHERE staff_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM staff WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default app;
