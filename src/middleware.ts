import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifySession, SESSION_COOKIE } from "./auth";
import type { Env, Variables } from "./types";

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export async function requireAuth(c: Ctx, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "認証が必要です" }, 401);
  const session = await verifySession(token, c.env.JWT_SECRET);
  if (!session) return c.json({ error: "セッションが無効です。再ログインしてください" }, 401);
  c.set("session", session);
  await next();
}

export async function requireAdmin(c: Ctx, next: Next) {
  const session = c.get("session");
  if (!session || session.role !== "admin") {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }
  await next();
}
