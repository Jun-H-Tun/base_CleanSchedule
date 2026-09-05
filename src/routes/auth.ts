import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { verifyPassword, signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../auth";
import { requireAuth } from "../middleware";
import type { Env, Variables } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password) {
    return c.json({ error: "ユーザー名とパスワードを入力してください" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.password_hash, u.role, u.staff_id, s.name as staff_name
     FROM users u LEFT JOIN staff s ON s.id = u.staff_id
     WHERE u.username = ?`
  )
    .bind(username)
    .first<{
      id: number;
      username: string;
      password_hash: string;
      role: "admin" | "staff";
      staff_id: number | null;
      staff_name: string | null;
    }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "ユーザー名またはパスワードが違います" }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession(
    {
      uid: user.id,
      role: user.role,
      staffId: user.staff_id,
      staffName: user.staff_name,
      username: user.username,
      exp,
    },
    c.env.JWT_SECRET
  );

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return c.json({
    role: user.role,
    staffId: user.staff_id,
    staffName: user.staff_name,
    username: user.username,
  });
});

app.post("/logout", async (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/me", requireAuth, async (c) => {
  const session = c.get("session");
  return c.json({
    role: session.role,
    staffId: session.staffId,
    staffName: session.staffName,
    username: session.username,
  });
});

export default app;
