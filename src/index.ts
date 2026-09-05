import { Hono } from "hono";
import type { Env, Variables } from "./types";
import authRoutes from "./routes/auth";
import staffRoutes from "./routes/staff";
import unitsRoutes from "./routes/units";
import reservationsRoutes from "./routes/reservations";
import availabilityRoutes from "./routes/availability";
import tasksRoutes from "./routes/tasks";

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

export default app;
