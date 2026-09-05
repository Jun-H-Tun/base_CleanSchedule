import type { SessionPayload } from "./auth";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  INGEST_API_KEY?: string;
}

export type Variables = {
  session: SessionPayload;
};

export interface StaffRow {
  id: number;
  name: string;
  is_external: number;
  priority_order: number | null;
  color_code: string | null;
  created_at: string;
}

export interface UnitRow {
  id: number;
  unit_name: string;
  max_capacity: number;
}

export interface ReservationRow {
  id: number;
  unit_id: number;
  checkout_date: string;
  next_checkin_date: string | null;
  next_guest_count: number | null;
  notes: string | null;
  synced_at: string;
}

export interface AvailabilityRow {
  id: number;
  staff_id: number;
  target_date: string;
  availability_type: "3件" | "2件" | "1件" | "✕" | "13:30〜";
  submitted_at: string;
}

export interface CleaningTaskRow {
  id: number;
  reservation_id: number;
  cleaning_date: string;
  is_same_day_turnover: number;
  assigned_staff_id: number | null;
  is_manual_override: number;
  status: "assigned" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
}
