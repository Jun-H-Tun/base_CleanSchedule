import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { requireAuth } from "../middleware";
import { verifySession, SESSION_COOKIE } from "../auth";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 次回チェックインまでの猶予日数がこれ以上、または未定(NULL)の場合は
// 「一律6名」として表示する(仕様書 4-2)。
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

// beds24 の予約取り込み(Claude in Chrome -> Claude Code)専用の認証:
// ログインクッキー、または共有シークレット `X-Api-Key` のどちらかで許可する。
async function requireAuthOrIngestKey(c: any, next: any) {
  const apiKey = c.req.header("X-Api-Key");
  if (apiKey && c.env.INGEST_API_KEY && apiKey === c.env.INGEST_API_KEY) {
    await next();
    return;
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await verifySession(token, c.env.JWT_SECRET);
    if (session) {
      c.set("session", session);
      await next();
      return;
    }
  }
  return c.json({ error: "認証が必要です(セッションまたはX-Api-Keyが必要です)" }, 401);
}

app.get("/", requireAuth, async (c) => {
  const start = c.req.query("start");
  const end = c.req.query("end");
  if (!start || !end) return c.json({ error: "start, end は必須です(YYYY-MM-DD)" }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.unit_id, u.unit_name, r.checkout_date, r.next_checkin_date,
            r.next_guest_count, r.notes, r.synced_at
     FROM reservations r JOIN units u ON u.id = r.unit_id
     WHERE r.checkout_date BETWEEN ? AND ?
     ORDER BY r.checkout_date, u.unit_name`
  )
    .bind(start, end)
    .all<any>();

  const withDisplay = (results ?? []).map((r) => ({
    ...r,
    display_guest_count: displayGuestCount(r.checkout_date, r.next_checkin_date, r.next_guest_count),
    is_far_next: !r.next_checkin_date || daysBetween(r.checkout_date, r.next_checkin_date) >= FAR_NEXT_CHECKIN_DAYS,
  }));

  return c.json(withDisplay);
});

// POST /api/reservations/upsert
// body: { unitName: "b1", checkoutDate: "2026-09-10", nextCheckinDate: "2026-09-10"|null,
//         nextGuestCount: number|null, notes: string|null }
// unit_id + checkout_date が一致すれば更新、なければ新規追加。
app.post("/upsert", requireAuthOrIngestKey, async (c) => {
  const body = await c.req.json().catch(() => null);
  const unitName = body?.unitName?.trim();
  const checkoutDate = body?.checkoutDate;
  if (!unitName || !checkoutDate) {
    return c.json({ error: "unitName, checkoutDate は必須です" }, 400);
  }

  const unit = await c.env.DB.prepare("SELECT id FROM units WHERE unit_name = ?")
    .bind(unitName)
    .first<{ id: number }>();
  if (!unit) return c.json({ error: `不明なユニットです: ${unitName}` }, 400);

  const nextCheckinDate = body?.nextCheckinDate ?? null;
  const nextGuestCount = body?.nextGuestCount ?? null;
  const notes = body?.notes ?? null;

  await c.env.DB.prepare(
    `INSERT INTO reservations (unit_id, checkout_date, next_checkin_date, next_guest_count, notes, synced_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(unit_id, checkout_date) DO UPDATE SET
       next_checkin_date = excluded.next_checkin_date,
       next_guest_count = excluded.next_guest_count,
       notes = excluded.notes,
       synced_at = datetime('now')`
  )
    .bind(unit.id, checkoutDate, nextCheckinDate, nextGuestCount, notes)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT id FROM reservations WHERE unit_id = ? AND checkout_date = ?"
  )
    .bind(unit.id, checkoutDate)
    .first<{ id: number }>();

  return c.json({ ok: true, reservationId: row?.id });
});

// beds24連携ツールが複数件まとめて送れるように一括版も用意
app.post("/upsert-batch", requireAuthOrIngestKey, async (c) => {
  const body = await c.req.json().catch(() => null);
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return c.json({ error: "items(配列)は必須です" }, 400);

  let count = 0;
  for (const item of items) {
    const unitName = item?.unitName?.trim();
    const checkoutDate = item?.checkoutDate;
    if (!unitName || !checkoutDate) continue;
    const unit = await c.env.DB.prepare("SELECT id FROM units WHERE unit_name = ?")
      .bind(unitName)
      .first<{ id: number }>();
    if (!unit) continue;
    await c.env.DB.prepare(
      `INSERT INTO reservations (unit_id, checkout_date, next_checkin_date, next_guest_count, notes, synced_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(unit_id, checkout_date) DO UPDATE SET
         next_checkin_date = excluded.next_checkin_date,
         next_guest_count = excluded.next_guest_count,
         notes = excluded.notes,
         synced_at = datetime('now')`
    )
      .bind(unit.id, checkoutDate, item?.nextCheckinDate ?? null, item?.nextGuestCount ?? null, item?.notes ?? null)
      .run();
    count++;
  }

  return c.json({ ok: true, count });
});

export default app;
