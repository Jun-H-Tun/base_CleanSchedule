// 自動割り振りの実行本体。HTTP経由の手動実行(POST /api/tasks/generate)と、
// 毎日決まった時刻に走るCron Trigger(src/index.ts の scheduled ハンドラ)の
// 両方から呼び出す共通ロジック。

import { assignDay, type AssignmentStaffInput, type AssignmentTaskInput } from "./assignment";

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 沖縄(JST, UTC+9)基準の「今日」の日付文字列(YYYY-MM-DD) */
export function todayJST(): string {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jstNow.toISOString().slice(0, 10);
}

export interface GenerateSummary {
  date: string;
  assigned: number;
  unassigned: number;
}

/**
 * 指定期間内の各日について貪欲法で自動割り振りを行う。is_manual_override=1 の
 * タスクや status が completed/cancelled のタスクは対象外(上書きしない)。
 * 既に自動割り当て済み(is_manual_override=0, status=assigned)のタスクは、
 * 予定入力の後追い変更などを反映するため毎回再計算する(冪等)。
 */
export async function generateTasksForRange(
  db: D1Database,
  start: string,
  end: string
): Promise<GenerateSummary[]> {
  const staffRows = (
    await db
      .prepare("SELECT id, name, is_external, priority_order FROM staff ORDER BY is_external, priority_order")
      .all<any>()
  ).results as any[];

  let cursor = start;
  const summary: GenerateSummary[] = [];

  while (cursor <= end) {
    const date = cursor;
    cursor = addDays(cursor, 1);

    // その日にチェックアウトする予約 = 清掃対象
    const reservations = (
      await db
        .prepare(
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
      await db
        .prepare(
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
      await db
        .prepare("SELECT staff_id, availability_type FROM staff_availability WHERE target_date = ?")
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
        await db
          .prepare(
            `UPDATE cleaning_tasks SET assigned_staff_id = ?, is_same_day_turnover = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(r.assignedStaffId, task.isSameDayTurnover ? 1 : 0, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO cleaning_tasks (reservation_id, cleaning_date, is_same_day_turnover, assigned_staff_id, is_manual_override, status)
             VALUES (?, ?, ?, ?, 0, 'assigned')`
          )
          .bind(r.reservationId, date, task.isSameDayTurnover ? 1 : 0, r.assignedStaffId)
          .run();
      }
    }
    summary.push({ date, assigned: assignedCount, unassigned: unassignedCount });
  }

  return summary;
}
