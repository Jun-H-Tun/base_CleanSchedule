-- 民泊清掃管理アプリ 初期スキーマ
-- 設計元: cleaning-app-db-design.md

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- 細田/普久原/福田/Rクリーン
  is_external BOOLEAN NOT NULL DEFAULT 0,  -- Rクリーンなら1
  priority_order INTEGER,                  -- 割り振り優先順位(1,2,3...) Rクリーンは最後
  color_code TEXT,                         -- カレンダー表示色(スタッフ毎に色分け)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER REFERENCES staff(id),   -- 管理者アカウントはNULL可
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','staff')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_name TEXT UNIQUE NOT NULL,          -- b1〜b9
  max_capacity INTEGER NOT NULL DEFAULT 6  -- 全棟共通だが将来の変更に備えて個別保持
);

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  checkout_date TEXT NOT NULL,       -- 清掃対象日の基準(YYYY-MM-DD)
  next_checkin_date TEXT,            -- NULL = 次回予約未定(1週間ルール適用対象)
  next_guest_count INTEGER,          -- NULLの場合は表示時に6名固定として扱う
  notes TEXT,                        -- beds24備考欄をそのままコピー(ベビーベッド等)
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(unit_id, checkout_date)
);

CREATE INDEX idx_reservations_checkout ON reservations(checkout_date);

CREATE TABLE staff_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  target_date TEXT NOT NULL,
  availability_type TEXT NOT NULL CHECK(
    availability_type IN ('3件','2件','1件','✕','13:30〜')
  ),
  submitted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(staff_id, target_date)
);

CREATE TABLE cleaning_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  cleaning_date TEXT NOT NULL,             -- 実際の清掃実施日(当日 or 翌日)
  is_same_day_turnover BOOLEAN NOT NULL DEFAULT 0,
  assigned_staff_id INTEGER REFERENCES staff(id), -- Rクリーンもstaffの1レコード
  is_manual_override BOOLEAN NOT NULL DEFAULT 0,  -- 管理者が手動修正した場合1
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK(status IN ('assigned','completed','cancelled')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(reservation_id)
);

CREATE INDEX idx_cleaning_tasks_date ON cleaning_tasks(cleaning_date);

-- ── 初期データ ──────────────────────────────────────────────

INSERT INTO staff (name, is_external, priority_order, color_code) VALUES
  ('細田さん', 0, 1, '#4A90D9'),
  ('普久原さん', 0, 2, '#E8A33D'),
  ('福田さん', 0, 3, '#6FBF73'),
  ('Rクリーン', 1, 4, '#999999');

INSERT INTO units (unit_name, max_capacity) VALUES
  ('b1', 6), ('b2', 6), ('b3', 6), ('b4', 6), ('b5', 6),
  ('b6', 6), ('b7', 6), ('b8', 6), ('b9', 6);

-- 初期管理者アカウント: username=admin / password=admin1234 (初回ログイン後に必ず変更してください)
-- password_hash 形式: pbkdf2$<iterations>$<salt-hex>$<hash-hex>
INSERT INTO users (staff_id, username, password_hash, role) VALUES
  (NULL, 'admin', 'pbkdf2$100000$19dbbbd7856a234056cdf990c83b154a$6d06f7a41190359075f259694ed1515dc462c1c0b91fe99221a38bec2f17abda', 'admin');
