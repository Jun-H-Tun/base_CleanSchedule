// TimeTree風の月表示カレンダーを組み立てる共通ヘルパー。
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateStr(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function todayStr() {
  const t = new Date();
  return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
}

/**
 * @param {number} year
 * @param {number} month 0-indexed
 * @param {(cell: HTMLElement, dateStr: string, inMonth: boolean) => void} renderDay
 * @returns {HTMLElement}
 */
function buildMonthGrid(year, month, renderDay) {
  const grid = document.createElement("div");
  grid.className = "month-grid";

  const weekdayRow = document.createElement("div");
  weekdayRow.className = "weekday-row";
  WEEKDAYS_JA.forEach((w, i) => {
    const el = document.createElement("div");
    el.className = "weekday" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
    el.textContent = w;
    weekdayRow.appendChild(el);
  });
  grid.appendChild(weekdayRow);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const today = todayStr();

  for (let i = 0; i < totalCells; i++) {
    let dateStr, inMonth;
    if (i < startWeekday) {
      const d = prevMonthDays - startWeekday + i + 1;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      dateStr = toDateStr(prevYear, prevMonth, d);
      inMonth = false;
    } else if (i >= startWeekday + daysInMonth) {
      const d = i - (startWeekday + daysInMonth) + 1;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      dateStr = toDateStr(nextYear, nextMonth, d);
      inMonth = false;
    } else {
      const d = i - startWeekday + 1;
      dateStr = toDateStr(year, month, d);
      inMonth = true;
    }

    const cell = document.createElement("div");
    cell.className = "day-cell" + (inMonth ? "" : " other-month") + (dateStr === today ? " today" : "");
    cell.dataset.date = dateStr;

    const dayNum = document.createElement("div");
    dayNum.className = "day-num";
    dayNum.textContent = String(Number(dateStr.slice(8, 10)));
    cell.appendChild(dayNum);

    renderDay(cell, dateStr, inMonth);
    grid.appendChild(cell);
  }

  return grid;
}

function monthRange(year, month) {
  const start = toDateStr(year, month, 1);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const end = toDateStr(year, month, lastDay);
  return { start, end };
}
