// App-wide data: the normalised dataset, today's tasks, status and identity.
// One fetch on load; refetch on demand. Everything derived (groups, totals) is computed in pages.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Me, Rental, Status, Task, TaskOutcome } from '@shared/types';
import { DEFAULT_RULES, type RulesConfig } from '@shared/config/rules';
import { ApiError, api, type DataResponse } from './api';

export type AuthState = 'checking' | 'setup' | 'signed_out' | 'signed_in';

interface Store {
  auth: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  setup: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  error: string | null;
  me: Me | null;
  status: Status | null;
  data: DataResponse | null;
  rules: RulesConfig;
  today: string;
  rentals: Rental[];
  byRa: Map<string, Rental>;
  tasks: Task[];
  reload: () => Promise<void>;
  refreshNow: () => Promise<string>;
  taskAction: (id: number, body: Record<string, unknown>) => Promise<void>;
  createTask: (ra: string, note: string | null) => Promise<void>;
  selectedRa: string | null;
  openRental: (ra: string | null) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const Ctx = createContext<Store | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedRa, setSelectedRa] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const inflight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        setError(null);
        let m: Me;
        try {
          m = await api.me();
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            const { needsSetup } = await api.setupNeeded();
            setAuth(needsSetup ? 'setup' : 'signed_out');
            setMe(null);
            return;
          }
          throw e;
        }
        if (m.mustChangePassword) {
          // the API serves nothing else until the password is changed; App shows the change-password card
          setMe(m);
          setAuth('signed_in');
          return;
        }
        const [s, d, t] = await Promise.all([api.status(), api.data(), api.tasks()]);
        setMe(m);
        setStatus(s);
        setData(d);
        setTasks(t);
        setAuth('signed_in');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 5 * 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const signIn = useCallback(async (email: string, password: string) => {
    await api.login(email, password);
    setLoading(true);
    await reload();
  }, [reload]);

  const setup = useCallback(async (email: string, name: string, password: string) => {
    await api.setup({ email, name, password });
    setLoading(true);
    await reload();
  }, [reload]);

  const signOut = useCallback(async () => {
    await api.logout();
    setMe(null);
    setData(null);
    setTasks([]);
    setAuth('signed_out');
  }, []);

  const refreshNow = useCallback(async () => {
    const r = await api.refresh();
    await reload();
    const created = r.pull.pulled === 'loaded' ? r.pull.tasksCreated + r.tasksCreated : r.tasksCreated;
    const tasks = created ? `, ${created} new task${created === 1 ? '' : 's'}` : '';
    switch (r.pull.pulled) {
      case 'loaded': return `New TSD data loaded (${r.pull.rentals} rentals)${tasks}`;
      case 'unchanged': return `Already up to date with TSD${tasks}`;
      case 'failed': return `Could not get new TSD data: ${r.pull.error}`;
      default: return `Refreshed${tasks}`;
    }
  }, [reload]);

  const taskAction = useCallback(async (id: number, body: Record<string, unknown>) => {
    const updated = await api.taskAction(id, body);
    setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const createTask = useCallback(async (ra: string, note: string | null) => {
    const t = await api.createTask(ra, note);
    setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const rentals = useMemo(() => data?.rentals ?? [], [data]);
  const byRa = useMemo(() => new Map(rentals.map((r) => [r.raNumber, r])), [rentals]);
  const rules = data?.rules ?? DEFAULT_RULES;
  const today = status?.today ?? new Date().toISOString().slice(0, 10);

  const value: Store = {
    auth, signIn, setup, signOut,
    loading, error, me, status, data, rules, today, rentals, byRa, tasks, reload, refreshNow, taskAction, createTask,
    selectedRa, openRental: setSelectedRa, theme, toggleTheme,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside DataProvider');
  return s;
}

export type { TaskOutcome };
