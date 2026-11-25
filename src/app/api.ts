import type { Dataset, Me, Snapshot, Status, Task, TaskEvent, TaskOutcome, TeamNote, User } from '@shared/types';
import type { RulesConfig } from '@shared/config/rules';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep statusText */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export type DataResponse = Dataset & { receivedAt: string | null; rules: RulesConfig };

export const api = {
  setupNeeded: () => call<{ needsSetup: boolean }>('/api/auth/setup'),
  setup: (body: { email: string; name: string; password: string }) => call<{ ok: boolean }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  login: (email: string, password: string) => call<{ ok: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (current: string, next: string) => call<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  users: () => call<User[]>('/api/users'),
  createUser: (body: { email: string; name: string; password: string; isAdmin: boolean }) => call<User>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (email: string, body: { name?: string; isAdmin?: boolean; active?: boolean; password?: string }) => call<User>(`/api/users/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteUser: (email: string) => call<{ ok: boolean }>(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  me: () => call<Me>('/api/me'),
  status: () => call<Status>('/api/status'),
  data: () => call<DataResponse>('/api/data'),
  refresh: () => call<{ ok: boolean; tasksCreated: number; pull: RefreshPull }>('/api/refresh', { method: 'POST' }),
  tasks: (date?: string) => call<Task[]>(`/api/tasks${date ? `?date=${date}` : ''}`),
  tasksRange: (from: string, to: string) => call<Task[]>(`/api/tasks?from=${from}&to=${to}`),
  tasksForRental: (ra: string) => call<Task[]>(`/api/tasks/rental/${encodeURIComponent(ra)}`),
  createTask: (raNumber: string, note: string | null) => call<Task>('/api/tasks', { method: 'POST', body: JSON.stringify({ raNumber, note }) }),
  taskAction: (id: number, body: Record<string, unknown>) => call<Task>(`/api/tasks/${id}/action`, { method: 'POST', body: JSON.stringify(body) }),
  events: (fromIso: string, toIso: string) => call<TaskEvent[]>(`/api/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
  notes: (ra?: string) => call<TeamNote[]>(`/api/notes${ra ? `?ra=${encodeURIComponent(ra)}` : ''}`),
  addNote: (raNumber: string, text: string, taskId?: number | null) => call<TeamNote>('/api/notes', { method: 'POST', body: JSON.stringify({ raNumber, text, taskId }) }),
  history: () => call<Snapshot[]>('/api/history'),
  settings: () => call<SettingsResponse>('/api/settings'),
  saveRules: (body: Record<string, unknown>) => call<{ ok: boolean }>('/api/settings/rules', { method: 'PUT', body: JSON.stringify(body) }),
  saveContact: (key: string, body: Record<string, unknown>) => call<{ ok: boolean }>(`/api/settings/contacts/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteContact: (key: string) => call<{ ok: boolean }>(`/api/settings/contacts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  saveAlias: (body: { alias: string; canonical: string; kind: 'bodyshop' | 'insurer' }) => call<{ ok: boolean }>('/api/settings/aliases', { method: 'PUT', body: JSON.stringify(body) }),
  deleteAlias: (alias: string) => call<{ ok: boolean }>(`/api/settings/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' }),
};

/** What "Refresh now" did with the corporate portal's TSD extract. */
export type RefreshPull =
  | { pulled: 'not_configured' }
  | { pulled: 'unchanged'; fetchedAt: string }
  | { pulled: 'loaded'; fetchedAt: string; rentals: number; tasksCreated: number }
  | { pulled: 'failed'; error: string };

export interface SettingsResponse {
  rules: RulesConfig;
  adminEmails: string[];
  contacts: { key: string; display_name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; updated_at: string; updated_by: string }[];
  aliases: { alias: string; canonical: string; kind: string; updated_at: string; updated_by: string }[];
  me: Me;
}

export const OUTCOMES: { value: TaskOutcome; label: string; needsDate?: 'extended' | 'promised' }[] = [
  { value: 'extended', label: 'Extended to…', needsDate: 'extended' },
  { value: 'returned', label: 'Returned' },
  { value: 'payment_promised', label: 'Payment promised…', needsDate: 'promised' },
  { value: 'paid', label: 'Paid' },
  { value: 'verified', label: 'Insurance verified' },
  { value: 'unreachable', label: 'Unreachable' },
  { value: 'other', label: 'Other' },
];
