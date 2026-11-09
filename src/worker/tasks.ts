// Task generation and mutations on D1. Pure rules come from @shared/rules.
import type { Env } from './env';
import type { Dataset, Snapshot, Task, TaskEvent, TaskOutcome, TaskReason, TaskStatus } from '@shared/types';
import type { RulesConfig } from '@shared/config/rules';
import { amountAtRisk, classify, collectionTotals, isCompanyPayer, priorityOf, taskReasons } from '@shared/rules';

interface TaskRow {
  id: number; task_date: string; ra_number: string; reason: string; priority: number; status: string;
  assigned_to: string | null; snoozed_until: string | null; outcome: string | null; outcome_date: string | null; outcome_note: string | null;
  created_at: string; started_at: string | null; started_by: string | null; completed_at: string | null; completed_by: string | null; updated_at: string;
}

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id, taskDate: r.task_date, raNumber: r.ra_number, reason: r.reason as TaskReason, priority: r.priority, status: r.status as TaskStatus,
    assignedTo: r.assigned_to, snoozedUntil: r.snoozed_until, outcome: r.outcome as TaskOutcome | null, outcomeDate: r.outcome_date, outcomeNote: r.outcome_note,
    createdAt: r.created_at, startedAt: r.started_at, startedBy: r.started_by, completedAt: r.completed_at, completedBy: r.completed_by, updatedAt: r.updated_at,
  };
}

/**
 * Make sure every rental that needs attention on `date` has a task row. Idempotent: existing
 * (date, ra, reason) rows are left alone, so statuses survive repeated calls. A task snoozed
 * earlier to a date after `date` is carried over as snoozed.
 */
/**
 * Verification tasks close themselves when a TSD note verifies (or denies) the coverage. Runs on every push / refresh.
 * Coverage-ending tasks close when the rental is returned or the covered days were extended.
 */
export async function autoCompleteVerifications(env: Env, dataset: Dataset, date: string): Promise<number> {
  const open = await env.DB.prepare("SELECT * FROM tasks WHERE task_date = ? AND reason IN ('verify_insurance', 'coverage_ending') AND status != 'completed'").bind(date).all<TaskRow>();
  const byRa = new Map(dataset.rentals.map((r) => [r.raNumber, r]));
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const row of open.results) {
    const r = byRa.get(row.ra_number);
    let outcome: TaskOutcome | null = null;
    let note: string | null = null;
    if (row.reason === 'verify_insurance') {
      if (r?.coverage.status === 'verified' || r?.coverage.status === 'verified_days_unknown') { outcome = 'verified'; note = r.coverage.note; }
      else if (r?.coverage.status === 'denied') { outcome = 'other'; note = `Coverage denied: ${r.coverage.note ?? ''}`.trim(); }
      else if (r && !r.isOut) { outcome = 'returned'; note = 'Returned before verification'; }
    } else if (row.reason === 'coverage_ending') {
      if (r && !r.isOut) { outcome = 'returned'; note = null; }
      else if (r && (r.coverage.daysLeft ?? -1) >= 0) { outcome = 'extended'; note = `Coverage extended: ${r.coverage.note ?? ''}`.trim(); }
    }
    if (!outcome) continue;
    stmts.push(env.DB.prepare("UPDATE tasks SET status = 'completed', outcome = ?, outcome_note = COALESCE(outcome_note, ?), completed_at = ?, completed_by = 'tsd-note', updated_at = ? WHERE id = ?").bind(outcome, note, now, now, row.id));
    stmts.push(env.DB.prepare('INSERT INTO task_events (task_id, ra_number, action, detail, at, by) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.ra_number, 'complete', JSON.stringify({ outcome, note, auto: true }), now, 'tsd-note'));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length / 2;
}

export async function ensureTasks(env: Env, dataset: Dataset, date: string, rules: RulesConfig): Promise<{ created: number; autoCompleted: number }> {
  const existing = await env.DB.prepare('SELECT ra_number, reason FROM tasks WHERE task_date = ?').bind(date).all<{ ra_number: string; reason: string }>();
  const have = new Set(existing.results.map((r) => `${r.ra_number}|${r.reason}`));
  const snoozed = await env.DB.prepare("SELECT ra_number, reason, snoozed_until FROM tasks WHERE status = 'snoozed' AND snoozed_until > ? AND task_date < ?")
    .bind(date, date).all<{ ra_number: string; reason: string; snoozed_until: string }>();
  const snoozeMap = new Map(snoozed.results.map((r) => [`${r.ra_number}|${r.reason}`, r.snoozed_until]));

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const r of dataset.rentals) {
    for (const reason of taskReasons(r, date, rules)) {
      const key = `${r.raNumber}|${reason}`;
      if (have.has(key)) continue;
      const until = snoozeMap.get(key) ?? null;
      stmts.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO tasks (task_date, ra_number, reason, priority, status, snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(date, r.raNumber, reason, priorityOf(reason, rules), until ? 'snoozed' : 'not_started', until, now, now),
      );
      have.add(key);
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  const autoCompleted = await autoCompleteVerifications(env, dataset, date);
  return { created: stmts.length, autoCompleted };
}

export async function listTasks(env: Env, date: string): Promise<Task[]> {
  const res = await env.DB.prepare('SELECT * FROM tasks WHERE task_date = ? ORDER BY priority, ra_number').bind(date).all<TaskRow>();
  return res.results.map(rowToTask);
}

export async function listTasksRange(env: Env, from: string, to: string): Promise<Task[]> {
  const res = await env.DB.prepare('SELECT * FROM tasks WHERE task_date BETWEEN ? AND ? ORDER BY task_date DESC, priority, ra_number').bind(from, to).all<TaskRow>();
  return res.results.map(rowToTask);
}

export async function tasksForRental(env: Env, ra: string): Promise<Task[]> {
  const res = await env.DB.prepare('SELECT * FROM tasks WHERE ra_number = ? ORDER BY task_date DESC, id DESC').bind(ra).all<TaskRow>();
  return res.results.map(rowToTask);
}

export async function getTask(env: Env, id: number): Promise<Task | null> {
  const row = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  return row ? rowToTask(row) : null;
}

async function logEvent(env: Env, task: Task, action: string, by: string, detail: Record<string, unknown> | null): Promise<void> {
  await env.DB.prepare('INSERT INTO task_events (task_id, ra_number, action, detail, at, by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(task.id, task.raNumber, action, detail ? JSON.stringify(detail) : null, new Date().toISOString(), by).run();
}

export async function createManualTask(env: Env, ra: string, date: string, by: string, note: string | null): Promise<Task> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO tasks (task_date, ra_number, reason, priority, status, outcome_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(date, ra, 'manual', 6, 'not_started', note, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE task_date = ? AND ra_number = ? AND reason = 'manual'").bind(date, ra).first<TaskRow>();
  const task = rowToTask(row!);
  await logEvent(env, task, 'create', by, note ? { note } : null);
  return task;
}

export type TaskAction =
  | { action: 'start' }
  | { action: 'complete'; outcome: TaskOutcome; outcomeDate?: string | null; note?: string | null }
  | { action: 'snooze'; until: string; note?: string | null }
  | { action: 'reopen' }
  | { action: 'assign'; to: string | null };

export async function applyTaskAction(env: Env, id: number, a: TaskAction, by: string): Promise<Task> {
  const t = await getTask(env, id);
  if (!t) throw new Error('Task not found');
  const now = new Date().toISOString();
  switch (a.action) {
    case 'start':
      await env.DB.prepare("UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, ?), started_by = COALESCE(started_by, ?), assigned_to = COALESCE(assigned_to, ?), snoozed_until = NULL, updated_at = ? WHERE id = ?")
        .bind(now, by, by, now, id).run();
      break;
    case 'complete':
      await env.DB.prepare("UPDATE tasks SET status = 'completed', outcome = ?, outcome_date = ?, outcome_note = ?, completed_at = ?, completed_by = ?, started_at = COALESCE(started_at, ?), started_by = COALESCE(started_by, ?), updated_at = ? WHERE id = ?")
        .bind(a.outcome, a.outcomeDate ?? null, a.note ?? null, now, by, now, by, now, id).run();
      break;
    case 'snooze':
      await env.DB.prepare("UPDATE tasks SET status = 'snoozed', snoozed_until = ?, outcome_note = COALESCE(?, outcome_note), updated_at = ? WHERE id = ?")
        .bind(a.until, a.note ?? null, now, id).run();
      break;
    case 'reopen':
      await env.DB.prepare("UPDATE tasks SET status = 'not_started', outcome = NULL, outcome_date = NULL, completed_at = NULL, completed_by = NULL, snoozed_until = NULL, updated_at = ? WHERE id = ?")
        .bind(now, id).run();
      break;
    case 'assign':
      await env.DB.prepare('UPDATE tasks SET assigned_to = ?, updated_at = ? WHERE id = ?').bind(a.to, now, id).run();
      break;
  }
  const updated = (await getTask(env, id))!;
  const { action, ...detail } = a as TaskAction & Record<string, unknown>;
  await logEvent(env, updated, action, by, Object.keys(detail).length ? detail : null);
  return updated;
}

export async function listEvents(env: Env, fromIso: string, toIso: string): Promise<TaskEvent[]> {
  const res = await env.DB.prepare('SELECT * FROM task_events WHERE at >= ? AND at < ? ORDER BY at DESC').bind(fromIso, toIso)
    .all<{ id: number; task_id: number; ra_number: string; action: string; detail: string | null; at: string; by: string }>();
  return res.results.map((e) => ({ id: e.id, taskId: e.task_id, raNumber: e.ra_number, action: e.action, detail: e.detail ? JSON.parse(e.detail) : null, at: e.at, by: e.by }));
}

// ---------- Snapshots ----------

/** 2 = money from rental charges only (tolls / tickets excluded). Older rows are NULL = "before fix". */
export const SNAPSHOT_RULES_VERSION = 2;

export async function saveSnapshot(env: Env, dataset: Dataset, date: string, ingestId: number, rules: RulesConfig): Promise<Snapshot> {
  const base = dataset.rentals.filter((r) => r.kind === 'rental');
  const out = base.filter((r) => r.isOut);
  const states = out.map((r) => ({ r, s: classify(r, date, rules) }));
  const overdue = states.filter((x) => x.s === 'overdue').map((x) => x.r);
  const totals = collectionTotals(dataset.rentals);
  const snap: Snapshot = {
    snapshotDate: date,
    createdAt: new Date().toISOString(),
    rulesVersion: SNAPSHOT_RULES_VERSION,
    overdueCount: overdue.length,
    overdueCustomer: overdue.filter((r) => !isCompanyPayer(r.payerType)).length,
    dueSoonCount: states.filter((x) => x.s === 'due_soon' || x.s === 'due_today').length,
    openEndedCount: states.filter((x) => x.s === 'open_ended').length,
    outCount: out.length,
    amountAtRisk: amountAtRisk(dataset.rentals, date, rules),
    outstandingTotal: totals.outstanding,
    billedTotal: totals.billed,
    collectedTotal: totals.collected,
    overdueRaNumbers: overdue.map((r) => r.raNumber).sort(),
    outRaNumbers: out.map((r) => r.raNumber).sort(),
  };
  await env.DB.prepare(
    `INSERT INTO snapshots (snapshot_date, ingest_id, created_at, overdue_count, overdue_customer, due_soon_count, open_ended_count, out_count, amount_at_risk, outstanding_total, billed_total, collected_total, overdue_ra_numbers, out_ra_numbers, rules_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_date) DO UPDATE SET ingest_id = excluded.ingest_id, created_at = excluded.created_at, overdue_count = excluded.overdue_count, overdue_customer = excluded.overdue_customer,
       due_soon_count = excluded.due_soon_count, open_ended_count = excluded.open_ended_count, out_count = excluded.out_count, amount_at_risk = excluded.amount_at_risk,
       outstanding_total = excluded.outstanding_total, billed_total = excluded.billed_total, collected_total = excluded.collected_total, overdue_ra_numbers = excluded.overdue_ra_numbers, out_ra_numbers = excluded.out_ra_numbers, rules_version = excluded.rules_version`,
  ).bind(
    snap.snapshotDate, ingestId, snap.createdAt, snap.overdueCount, snap.overdueCustomer, snap.dueSoonCount, snap.openEndedCount, snap.outCount,
    snap.amountAtRisk, snap.outstandingTotal, snap.billedTotal, snap.collectedTotal, JSON.stringify(snap.overdueRaNumbers), JSON.stringify(snap.outRaNumbers), snap.rulesVersion,
  ).run();
  return snap;
}

export async function listSnapshots(env: Env, limit = 120): Promise<Snapshot[]> {
  const res = await env.DB.prepare('SELECT * FROM snapshots ORDER BY snapshot_date DESC LIMIT ?').bind(limit).all<Record<string, unknown>>();
  return res.results.map((s) => ({
    snapshotDate: s.snapshot_date as string,
    createdAt: s.created_at as string,
    rulesVersion: (s.rules_version as number | null) ?? null,
    overdueCount: s.overdue_count as number,
    overdueCustomer: s.overdue_customer as number,
    dueSoonCount: s.due_soon_count as number,
    openEndedCount: s.open_ended_count as number,
    outCount: s.out_count as number,
    amountAtRisk: s.amount_at_risk as number,
    outstandingTotal: s.outstanding_total as number,
    billedTotal: s.billed_total as number,
    collectedTotal: s.collected_total as number,
    overdueRaNumbers: JSON.parse(s.overdue_ra_numbers as string),
    outRaNumbers: JSON.parse(s.out_ra_numbers as string),
  }));
}
