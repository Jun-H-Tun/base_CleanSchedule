import { Hono } from "hono";
import { requireAuth } from "../middleware";
import type { Env, Variables, UnitRow } from "../types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, unit_name, max_capacity FROM units ORDER BY unit_name"
  ).all<UnitRow>();
  return c.json(results ?? []);
});

export default app;
