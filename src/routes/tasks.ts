import { Hono } from "hono";
import { requireAuth, requireAdmin } from "../middleware";
import { assignDay, type AssignmentStaffInput, type AssignmentTaskInput } from "../assignment";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const FAR_NEXT_CHECKIN_DAYS = 7;

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function displayGuestCount(checkoutDate: string, nextCheckin: string | null, nextGuestCount: number | null): number {
  if (!nextCheckin) return 6;
  if (daysBetween(checkoutDate, nextCheckin) >= FAR_NEXT_CHECKIN_DAYS) return 6;
  return nextGuestCount ?? 6;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// GET /api/tasks?start=&end= : カレンダー表示用の一覧(スタッフ・物件・予約情報を結合)
app.get("/", requireAuth, async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) return c.json({ error: "start, end は必須です" }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT ct.id, ct.reservation_id, ct.cleaning_date, ct.is_same_day_turnover,
            ct.assigned_staff_id, ct.is_manual_override, ct.status,
            r.checkout_date, r.next_checkin_date, r.next_guest_count, r.notes,
            u.unit_name,
            s.name as staff_name, s.color_code, s.is_external
     FROM cleaning_tasks ct
     JOIN reservations r ON r.id = ct.reservation_id
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN staff s ON s.id = ct.assigned_staff_id
     WHERE ct.cleaning_date BETWEEN ? AND ?
     ORDER BY ct.cleaning_date, u.unit_name`
  )
    .bind(start, end)
    .all<any>();

  const withLabel = (results ?? []).map((t) => {
    const guestCount = displayGuestCount(t.checkout_date, t.next_checkin_date, t.next_guest_count);
    const parts = [`次回${guestCount}名`];
    if (t.notes && String(t.notes).trim()) parts.push(String(t.notes).trim());
    const label = `${t.staff_name ?? "未割当"}:${t.unit_name}(${parts.join("、")})`;
    return { ...t, display_guest_count: guestCount, label };
  });

  return c.json(withLabel);
});

// POST /api/tasks/generate  body: { start, end } (admin)
// 指定期間内の各日について貪欲法で自動割り振りを行う。is_manual_override=1 の
// タスクや status が completed/cancelled のタスクは対象外(上書きしない)。
app.post("/generate", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const start = body?.start;
  const end = body?.end;
  if (!start || !end) return c.json({ error: "start, end は必須です" }, 400);

  const staffRows = (
    await c.env.DB.prepare(
      "SELECT id, name, is_external, priority_order FROM staff ORDER BY is_external, priority_order"
    ).all<any>()
  ).results as any[];

  let cursor = start;
  const summary: { date: string; assigned: number; unassigned: number }[] = [];

  while (cursor <= end) {
    const date = cursor;
    cursor = addDays(cursor, 1);

    // その日にチェックアウトする予約 = 清掃対象
    const reservations = (
      await c.env.DB.prepare(
        `SELECT r.id as reservation_id, u.unit_name, r.checkout_date, r.next_checkin_date
         FROM reservations r JOIN units u ON u.id = r.unit_id
         WHERE r.checkout_date = ?`
      )
        .bind(date)
        .all<any>()
    ).results as any[];

    if (reservations.length === 0) continue;

    // 既存タスク(手動修正 or 完了/キャンセル済み)は再計算対象から除外
    const existingTasks = (
      await c.env.DB.prepare(
        `SELECT ct.* FROM cleaning_tasks ct
         JOIN reservations r ON r.id = ct.reservation_id
         WHERE ct.cleaning_date = ?`
      )
        .bind(date)
        .all<any>()
    ).results as any[];
    const frozenReservationIds = new Set(
      existingTasks.filter((t) => t.is_manual_override || t.status !== "assigned").map((t) => t.reservation_id)
    );

    const targetReservations = reservations.filter((r) => !frozenReservationIds.has(r.reservation_id));
    if (targetReservations.length === 0) continue;

    const availability = (
      await c.env.DB.prepare(
        "SELECT staff_id, availability_type FROM staff_availability WHERE target_date = ?"
      )
        .bind(date)
        .all<any>()
    ).results as any[];
    const availabilityMap = new Map<number, string>(availability.map((a) => [a.staff_id, a.availability_type]));

    const staffList: AssignmentStaffInput[] = staffRows.map((s) => ({
      staffId: s.id,
      name: s.name,
      isExternal: !!s.is_external,
      priorityOrder: s.priority_order,
      availabilityType: (availabilityMap.get(s.id) as any) ?? (s.is_external ? "3件" : null),
      // Rクリーン(外部)は予定入力の対象外なので、常に受け入れ可能として扱う
    }));

    const tasksInput: AssignmentTaskInput[] = targetReservations.map((r) => ({
      reservationId: r.reservation_id,
      unitName: r.unit_name,
      isSameDayTurnover: r.next_checkin_date === r.checkout_date,
    }));

    const results = assignDay(tasksInput, staffList);

    let assignedCount = 0;
    let unassignedCount = 0;
    for (const r of results) {
      const task = tasksInput.find((t) => t.reservationId === r.reservationId)!;
      if (r.assignedStaffId) assignedCount++;
      else unassignedCount++;

      const existing = existingTasks.find((t) => t.reservation_id === r.reservationId);
      if (existing) {
        await c.env.DB.prepare(
          `UPDATE cleaning_tasks SET assigned_staff_id = ?, is_same_day_turnover = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(r.assignedStaffId, task.isSameDayTurnover ? 1 : 0, existing.id)
          .run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO cleaning_tasks (reservation_id, cleaning_date, is_same_day_turnover, assigned_staff_id, is_manual_override, status)
           VALUES (?, ?, ?, ?, 0, 'assigned')`
        )
          .bind(r.reservationId, date, task.isSameDayTurnover ? 1 : 0, r.assignedStaffId)
          .run();
      }
    }
    summary.push({ date, assigned: assignedCount, unassigned: unassignedCount });
  }

  return c.json({ ok: true, summary });
});

// PUT /api/tasks/:id  body: { assignedStaffId?, cleaningDate? } (admin, ドラッグ&ドロップによる手動修正)
app.put("/:id", requireAuth, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare("SELECT * FROM cleaning_tasks WHERE id = ?").bind(id).first<any>();
  if (!existing) return c.json({ error: "タスクが見つかりません" }, 404);

  const assignedStaffId = body.assignedStaffId !== undefined ? body.assignedStaffId : existing.assigned_staff_id;
  const cleaningDate = body.cleaningDate ?? existing.cleaning_date;

  await c.env.DB.prepare(
    `UPDATE cleaning_tasks SET assigned_staff_id = ?, cleaning_date = ?, is_manual_override = 1, updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(assignedStaffId, cleaningDate, id)
    .run();

  return c.json({ ok: true });
});

// PUT /api/tasks/:id/status  body: { status: 'assigned'|'completed'|'cancelled' }
// 割り当てられたスタッフ本人、または管理者が完了報告できる。
app.put("/:id/status", requireAuth, async (c) => {
  const session = c.get("session");
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const status = body.status;
  if (!["assigned", "completed", "cancelled"].includes(status)) {
    return c.json({ error: "status は assigned/completed/cancelled のいずれかです" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT * FROM cleaning_tasks WHERE id = ?").bind(id).first<any>();
  if (!existing) return c.json({ error: "タスクが見つかりません" }, 404);

  if (session.role === "staff" && existing.assigned_staff_id !== session.staffId) {
    return c.json({ error: "自分に割り当てられたタスクのみ更新できます" }, 403);
  }

  await c.env.DB.prepare(
    "UPDATE cleaning_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(status, id)
    .run();

  return c.json({ ok: true });
});

app.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM cleaning_tasks WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default app;
