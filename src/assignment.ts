// 清掃タスクの自動割り振り(貪欲法)
//
// 仕様書 4-4 / 4-5 に基づく実装:
//  - 優先順位固定: 細田さん → 普久原さん → 福田さん → (以降の内部スタッフ) → Rクリーン(外部)
//  - 各スタッフの当日の空き予定(staff_availability)に応じて件数上限を適用
//  - 「13:30〜◯」は "同日ターンオーバー最大1件 + 翌日以降チェックインの部屋 最大1件" という
//    特殊ルール(福田さんの実質2件ルール)。福田さん固有の staff_id 判定ではなく、
//    availability_type 側にルールを持たせることで、将来同じ働き方をするスタッフが
//    増えても staff_rules テーブル追加なしに対応できるようにしている。

export interface AssignmentTaskInput {
  reservationId: number;
  unitName: string;
  isSameDayTurnover: boolean;
}

export interface AssignmentStaffInput {
  staffId: number;
  name: string;
  isExternal: boolean;
  priorityOrder: number | null;
  availabilityType: "3件" | "2件" | "1件" | "✕" | "13:30〜" | null; // null = 未入力
}

export interface AssignmentResult {
  reservationId: number;
  assignedStaffId: number | null; // 全スタッフが✕でRクリーンも存在しない場合のみnull
}

function capacityFor(type: AssignmentStaffInput["availabilityType"]): number {
  switch (type) {
    case "3件":
      return 3;
    case "2件":
      return 2;
    case "1件":
      return 1;
    case "13:30〜":
      return 2; // ただし内訳制限あり(下記allocateForStaff参照)
    case "✕":
    case null:
    default:
      return 0;
  }
}

/** 1人のスタッフに、残タスクリストから割り当てられるだけ割り当てて、割り当てた分を返す */
function allocateForStaff(
  staff: AssignmentStaffInput,
  remaining: AssignmentTaskInput[]
): AssignmentTaskInput[] {
  const cap = capacityFor(staff.availabilityType);
  if (cap === 0 || remaining.length === 0) return [];

  if (staff.availabilityType === "13:30〜") {
    // 同日ターンオーバー最大1件 + 翌日以降最大1件
    const allocated: AssignmentTaskInput[] = [];
    let turnoverUsed = false;
    let nonTurnoverUsed = false;
    for (const task of remaining) {
      if (allocated.length >= cap) break;
      if (task.isSameDayTurnover && !turnoverUsed) {
        allocated.push(task);
        turnoverUsed = true;
      } else if (!task.isSameDayTurnover && !nonTurnoverUsed) {
        allocated.push(task);
        nonTurnoverUsed = true;
      }
    }
    return allocated;
  }

  // 通常のスタッフ: 順番通りに上限件数まで
  return remaining.slice(0, cap);
}

/**
 * 1日分の清掃タスクを割り振る。
 * @param tasks その日の清掃対象一覧(まだ手動修正されていない = 再計算対象のもの)
 * @param staffList 優先順位順(is_external=0を先、priority_order昇順)に並んだスタッフ一覧
 *                  最後に is_external=1 のスタッフ(Rクリーン)を含めること。
 */
export function assignDay(
  tasks: AssignmentTaskInput[],
  staffList: AssignmentStaffInput[]
): AssignmentResult[] {
  // 同日ターンオーバーは制約が強いので優先的に割り振り対象の先頭に置く
  let remaining = [...tasks].sort((a, b) => {
    if (a.isSameDayTurnover !== b.isSameDayTurnover) return a.isSameDayTurnover ? -1 : 1;
    return a.unitName.localeCompare(b.unitName);
  });

  const assignments = new Map<number, number>(); // reservationId -> staffId

  const internalStaff = staffList
    .filter((s) => !s.isExternal)
    .sort((a, b) => (a.priorityOrder ?? 999) - (b.priorityOrder ?? 999));

  for (const staff of internalStaff) {
    if (remaining.length === 0) break;
    const allocated = allocateForStaff(staff, remaining);
    for (const task of allocated) {
      assignments.set(task.reservationId, staff.staffId);
    }
    const allocatedIds = new Set(allocated.map((t) => t.reservationId));
    remaining = remaining.filter((t) => !allocatedIds.has(t.reservationId));
  }

  if (remaining.length > 0) {
    const external = staffList
      .filter((s) => s.isExternal)
      .sort((a, b) => (a.priorityOrder ?? 999) - (b.priorityOrder ?? 999))[0];
    for (const task of remaining) {
      assignments.set(task.reservationId, external ? external.staffId : (null as unknown as number));
    }
  }

  return tasks.map((t) => ({
    reservationId: t.reservationId,
    assignedStaffId: assignments.has(t.reservationId) ? assignments.get(t.reservationId)! : null,
  }));
}
