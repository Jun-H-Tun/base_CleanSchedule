// ── グローバル状態 ──
const state = {
  user: null, // { role, staffId, staffName, username }
  staff: [], // 全スタッフマスタ
  units: [],
  view: "calendar",
  cal: { year: new Date().getFullYear(), month: new Date().getMonth() },
  avail: { year: new Date().getFullYear(), month: new Date().getMonth(), staffId: null },
};

const staffColor = (staffId) => {
  const s = state.staff.find((x) => x.id === staffId);
  return (s && s.color_code) || "#999999";
};
const staffById = (staffId) => state.staff.find((x) => x.id === staffId);

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── 認証 ──
async function init() {
  try {
    const me = await api.get("/auth/me");
    state.user = me;
    await afterLogin();
  } catch (_) {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app-screen").hidden = true;
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  try {
    const me = await api.post("/auth/login", { username, password });
    state.user = me;
    await afterLogin();
  } catch (err) {
    errEl.textContent = err.message || "ログインに失敗しました";
    errEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api.post("/auth/logout", {});
  location.reload();
});

async function afterLogin() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-screen").hidden = false;
  document.getElementById("user-label").textContent =
    state.user.role === "admin" ? `管理者: ${state.user.username}` : `${state.user.staffName || state.user.username}`;
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = state.user.role !== "admin"));

  const [staff, units] = await Promise.all([api.get("/staff"), api.get("/units")]);
  state.staff = staff;
  state.units = units;
  if (!state.avail.staffId) {
    state.avail.staffId = state.user.role === "staff" ? state.user.staffId : staff.find((s) => !s.is_external)?.id;
  }

  switchView(state.user.role === "staff" ? "availability" : "calendar");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "calendar") renderCalendarView();
  else if (view === "availability") renderAvailabilityView();
  else if (view === "staff") renderStaffView();
}

const root = document.getElementById("view-root");

// ══════════════════════════ カレンダー(清掃タスク)ビュー ══════════════════════════

async function renderCalendarView() {
  root.innerHTML = "";
  const { year, month } = state.cal;
  const toolbar = document.createElement("div");
  toolbar.className = "calendar-toolbar";
  toolbar.innerHTML = `
    <button id="cal-prev">◀ 前月</button>
    <h2>${year}年 ${month + 1}月</h2>
    <button id="cal-next">次月 ▶</button>
    <span class="spacer"></span>
    ${state.user.role === "admin" ? '<button id="cal-generate" class="gen-btn">この月を自動割り振り</button>' : ""}
  `;
  root.appendChild(toolbar);
  toolbar.querySelector("#cal-prev").onclick = () => shiftCalMonth(-1);
  toolbar.querySelector("#cal-next").onclick = () => shiftCalMonth(1);
  const genBtn = toolbar.querySelector("#cal-generate");
  if (genBtn) genBtn.onclick = () => runGenerate();

  const legend = document.createElement("div");
  legend.className = "avail-legend";
  legend.innerHTML = state.staff
    .map((s) => `<span style="border-color:${s.color_code}"><span class="color-dot" style="background:${s.color_code}"></span>${s.name}</span>`)
    .join("");
  root.appendChild(legend);

  const { start, end } = monthRange(year, month);
  const [tasks, reservations] = await Promise.all([
    api.get(`/tasks?start=${start}&end=${end}`),
    api.get(`/reservations?start=${start}&end=${end}`),
  ]);

  const tasksByDate = {};
  tasks.forEach((t) => {
    (tasksByDate[t.cleaning_date] = tasksByDate[t.cleaning_date] || []).push(t);
  });
  const taskedReservationIds = new Set(tasks.map((t) => t.reservation_id));
  reservations
    .filter((r) => !taskedReservationIds.has(r.id))
    .forEach((r) => {
      const label = `未割当:${r.unit_name}(次回${r.display_guest_count}名${r.notes ? "、" + r.notes : ""})`;
      (tasksByDate[r.checkout_date] = tasksByDate[r.checkout_date] || []).push({
        id: null,
        reservation_id: r.id,
        assigned_staff_id: null,
        label,
        cleaning_date: r.checkout_date,
      });
    });

  const grid = buildMonthGrid(year, month, (cell, dateStr) => {
    const dayTasks = tasksByDate[dateStr] || [];
    dayTasks.forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "task-chip" + (t.assigned_staff_id ? "" : " unassigned");
      chip.style.background = t.assigned_staff_id ? staffColor(t.assigned_staff_id) : "";
      chip.textContent = t.label;
      chip.title = t.label;
      if (state.user.role === "admin" && t.id) {
        chip.draggable = true;
        chip.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", String(t.id));
        });
      }
      chip.addEventListener("click", () => showDayModal(dateStr, tasksByDate[dateStr] || []));
      cell.appendChild(chip);
    });

    if (state.user.role === "admin") {
      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        cell.classList.add("drag-over");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
      cell.addEventListener("drop", async (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        const taskId = e.dataTransfer.getData("text/plain");
        if (!taskId) return;
        await api.put(`/tasks/${taskId}`, { cleaningDate: dateStr });
        showToast("清掃日を変更しました");
        renderCalendarView();
      });
    }
  });
  root.appendChild(grid);
}

function shiftCalMonth(diff) {
  let m = state.cal.month + diff;
  let y = state.cal.year;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  state.cal.year = y;
  state.cal.month = m;
  renderCalendarView();
}

async function runGenerate() {
  const { start, end } = monthRange(state.cal.year, state.cal.month);
  try {
    const res = await api.post("/tasks/generate", { start, end });
    const assigned = res.summary.reduce((a, s) => a + s.assigned, 0);
    const unassigned = res.summary.reduce((a, s) => a + s.unassigned, 0);
    showToast(`割り振り完了(割当${assigned}件 / 未割当${unassigned}件)`);
  } catch (err) {
    showToast("割り振りに失敗しました: " + err.message);
  }
  renderCalendarView();
}

function showDayModal(dateStr, dayTasks) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<button class="modal-close">×</button><h3>${dateStr} の清掃</h3>`;
  dayTasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "task-row";
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.style.background = t.assigned_staff_id ? staffColor(t.assigned_staff_id) : "#b7bac6";
    row.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = t.label;
    row.appendChild(label);

    if (state.user.role === "admin" && t.id) {
      const select = document.createElement("select");
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "未割当";
      select.appendChild(noneOpt);
      state.staff.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        if (t.assigned_staff_id === s.id) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", async () => {
        await api.put(`/tasks/${t.id}`, { assignedStaffId: select.value ? Number(select.value) : null });
        showToast("担当を変更しました");
        backdrop.remove();
        renderCalendarView();
      });
      row.appendChild(select);
    }

    if (t.id && (state.user.role === "admin" || (state.user.role === "staff" && t.assigned_staff_id === state.user.staffId))) {
      const btns = document.createElement("span");
      btns.className = "status-btns";
      const doneBtn = document.createElement("button");
      doneBtn.textContent = t.status === "completed" ? "完了済✓" : "完了報告";
      doneBtn.disabled = t.status === "completed";
      doneBtn.onclick = async () => {
        await api.put(`/tasks/${t.id}/status`, { status: "completed" });
        showToast("完了として記録しました");
        backdrop.remove();
        renderCalendarView();
      };
      btns.appendChild(doneBtn);
      row.appendChild(btns);
    }

    modal.appendChild(row);
  });
  if (dayTasks.length === 0) {
    const p = document.createElement("p");
    p.textContent = "この日の清掃対象はありません。";
    modal.appendChild(p);
  }
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  modal.querySelector(".modal-close").onclick = () => backdrop.remove();
  document.body.appendChild(backdrop);
}

// ══════════════════════════ 予定入力(スタッフ可否)ビュー ══════════════════════════

const AVAIL_TYPES = ["3件", "2件", "1件", "✕", "13:30〜"];

function isPastDeadlineClient(targetDate) {
  const d = new Date(targetDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  return todayStr() > d.toISOString().slice(0, 10);
}

async function renderAvailabilityView() {
  root.innerHTML = "";
  const { year, month } = state.avail;

  const toolbar = document.createElement("div");
  toolbar.className = "calendar-toolbar";
  toolbar.innerHTML = `<button id="av-prev">◀ 前月</button><h2>${year}年 ${month + 1}月 の予定</h2><button id="av-next">次月 ▶</button><span class="spacer"></span>`;
  if (state.user.role === "admin") {
    const select = document.createElement("select");
    state.staff.filter((s) => !s.is_external).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === state.avail.staffId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      state.avail.staffId = Number(select.value);
      renderAvailabilityView();
    });
    toolbar.appendChild(select);
  }
  root.appendChild(toolbar);
  toolbar.querySelector("#av-prev").onclick = () => shiftAvailMonth(-1);
  toolbar.querySelector("#av-next").onclick = () => shiftAvailMonth(1);

  const legend = document.createElement("div");
  legend.className = "avail-legend";
  legend.innerHTML = AVAIL_TYPES.map((t) => `<span class="tag-${t}">${t}</span>`).join("");
  root.appendChild(legend);

  const { start, end } = monthRange(year, month);
  const list = await api.get(`/availability?start=${start}&end=${end}&staffId=${state.avail.staffId}`);
  const byDate = {};
  list.forEach((a) => (byDate[a.target_date] = a));

  const grid = buildMonthGrid(year, month, (cell, dateStr) => {
    cell.classList.add("avail-cell");
    const entry = byDate[dateStr];
    if (entry) {
      const tag = document.createElement("span");
      tag.className = `avail-tag tag-${entry.availability_type}`;
      tag.textContent = entry.availability_type;
      cell.appendChild(tag);
    }
    if (isPastDeadlineClient(dateStr) && !entry) {
      const warn = document.createElement("div");
      warn.className = "deadline-warn";
      warn.textContent = "締切超過";
      cell.appendChild(warn);
    }
    cell.addEventListener("click", () => showAvailPicker(dateStr, entry));
  });
  root.appendChild(grid);
}

function shiftAvailMonth(diff) {
  let m = state.avail.month + diff;
  let y = state.avail.year;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  state.avail.year = y;
  state.avail.month = m;
  renderAvailabilityView();
}

function showAvailPicker(dateStr, entry) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<button class="modal-close">×</button><h3>${dateStr}</h3>`;
  const opts = document.createElement("div");
  opts.className = "avail-options";
  AVAIL_TYPES.forEach((type) => {
    const btn = document.createElement("button");
    btn.textContent = type;
    if (entry && entry.availability_type === type) btn.classList.add("selected");
    btn.onclick = async () => {
      await api.post("/availability", { staffId: state.avail.staffId, targetDate: dateStr, availabilityType: type });
      backdrop.remove();
      renderAvailabilityView();
    };
    opts.appendChild(btn);
  });
  modal.appendChild(opts);
  if (entry) {
    const del = document.createElement("button");
    del.textContent = "削除(未入力に戻す)";
    del.style.marginTop = "10px";
    del.onclick = async () => {
      await api.del(`/availability/${entry.id}`);
      backdrop.remove();
      renderAvailabilityView();
    };
    modal.appendChild(del);
  }
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  modal.querySelector(".modal-close").onclick = () => backdrop.remove();
  document.body.appendChild(backdrop);
}

// ══════════════════════════ スタッフ管理ビュー(管理者) ══════════════════════════

async function renderStaffView() {
  root.innerHTML = "";
  const table = document.createElement("table");
  table.className = "staff-table";
  table.innerHTML = `<thead><tr><th>色</th><th>名前</th><th>区分</th><th>優先順位</th><th>ログインID</th><th></th></tr></thead>`;
  const tbody = document.createElement("tbody");
  state.staff.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="color-dot" style="background:${s.color_code || "#999"}"></span></td>
      <td>${s.name}</td>
      <td>${s.is_external ? "外部業者" : "スタッフ"}</td>
      <td>${s.priority_order ?? "-"}</td>
      <td>${s.username ?? "(未設定)"}</td>
      <td><button data-id="${s.id}" class="del-staff-btn">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  root.appendChild(table);

  table.querySelectorAll(".del-staff-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("このスタッフを削除しますか?")) return;
      try {
        await api.del(`/staff/${btn.dataset.id}`);
        state.staff = await api.get("/staff");
        renderStaffView();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  const form = document.createElement("form");
  form.className = "staff-form";
  form.innerHTML = `
    <h3>スタッフを追加</h3>
    <div class="form-row">
      <label>名前<input name="name" required placeholder="例: 山田さん" /></label>
      <label>区分
        <select name="isExternal"><option value="0">スタッフ</option><option value="1">外部業者</option></select>
      </label>
      <label>優先順位<input name="priorityOrder" type="number" min="1" /></label>
      <label>カラー<input name="colorCode" type="color" value="#4A90D9" /></label>
    </div>
    <div class="form-row">
      <label>ログインID(任意)<input name="username" /></label>
      <label>初期パスワード(任意)<input name="password" type="text" /></label>
    </div>
    <button type="submit">追加</button>
  `;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await api.post("/staff", {
        name: fd.get("name"),
        isExternal: fd.get("isExternal") === "1",
        priorityOrder: fd.get("priorityOrder") ? Number(fd.get("priorityOrder")) : null,
        colorCode: fd.get("colorCode"),
        username: fd.get("username") || undefined,
        password: fd.get("password") || undefined,
      });
      state.staff = await api.get("/staff");
      renderStaffView();
      showToast("スタッフを追加しました");
    } catch (err) {
      showToast(err.message);
    }
  });
  root.appendChild(form);
}

init();
