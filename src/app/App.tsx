import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import * as RDropdown from '@radix-ui/react-dropdown-menu';
import { AlarmClock, Car, ClipboardCheck, FileBarChart, LayoutDashboard, MoreHorizontal, Moon, PieChart, RefreshCw, Settings2, Sun, Wallet, type LucideIcon } from 'lucide-react';
import { useStore } from './store';
import { Spinner, Toast, useToast } from './components/ui';
import { IconButton, StatusDot, TooltipProvider } from './ui/primitives';
import { Logo } from './ui/Logo';
import RentalDrawer from './components/RentalDrawer';
import TodayPage from './pages/Today';
import ActivePage from './pages/Active';
import OverduePage from './pages/Overdue';
import BalancesPage from './pages/Balances';
import CollectionsPage from './pages/Collections';
import ReportsPage from './pages/Reports';
import ShiftPage from './pages/Shift';
import SettingsPage from './pages/Settings';
import LoginPage, { ChangePasswordCard } from './pages/Login';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: 'Today', icon: LayoutDashboard },
  { to: '/active', label: 'Cars out', icon: Car },
  { to: '/overdue', label: 'Overdue', icon: AlarmClock },
  { to: '/shift', label: 'Shift handover', icon: ClipboardCheck },
  { to: '/balances', label: 'Balances', icon: Wallet },
  { to: '/collections', label: 'Collections', icon: PieChart },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

function freshness(fetchedAt: string | null, stale: boolean): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; time: string } {
  if (!fetchedAt) return { tone: 'neutral', time: '-' };
  const ageMin = (Date.now() - new Date(fetchedAt).getTime()) / 60_000;
  const time = new Date(fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return { tone: stale ? 'danger' : ageMin < 90 ? 'ok' : 'warn', time }; // hourly extract: up to ~65 min old is normal
}

export default function App() {
  const { auth, status, me, error, refreshNow, theme, toggleTheme, tasks, today, signOut, reload } = useStore();
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const loc = useLocation();

  if (auth === 'checking') return <div className="min-h-full bg-bg0"><Spinner /></div>;
  if (auth === 'setup' || auth === 'signed_out') return <LoginPage />;
  if (me?.mustChangePassword || changingPw) {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg0 p-4">
        <div className="flex w-full max-w-sm flex-col gap-3">
          <ChangePasswordCard forced={!!me?.mustChangePassword} onDone={() => { setChangingPw(false); showToast('Password changed'); void reload(); }} />
          {!me?.mustChangePassword && <button className="btn" onClick={() => setChangingPw(false)}>Cancel</button>}
          <Toast message={toast} />
        </div>
      </div>
    );
  }

  const openTasks = tasks.filter((t) => t.taskDate === today && (t.status === 'not_started' || t.status === 'in_progress')).length;
  const overdueOpen = tasks.some((t) => t.taskDate === today && t.status !== 'completed' && (t.reason === 'overdue_customer' || t.reason === 'overdue_company'));
  const title = NAV.find((n) => loc.pathname.startsWith(n.to))?.label ?? 'Today';
  const fresh = freshness(status?.fetchedAt ?? null, !!status?.stale);
  const initials = (me?.name ?? me?.email ?? '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');

  async function onRefresh() {
    setBusy(true);
    try { showToast(await refreshNow()); } catch (e) { showToast(e instanceof Error ? e.message : 'Refresh failed'); } finally { setBusy(false); }
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-full">
        {/* Sidebar: Drivo Blue. 224px, a 60px icon rail under 1200px, hidden on mobile (bottom bar instead). */}
        <aside className="sidebar-brand no-print sticky top-0 hidden h-screen w-[60px] shrink-0 flex-col text-on-brand md:flex xl:w-[224px]">
          <div className="flex h-16 items-center px-4 xl:px-5">
            <span className="xl:hidden"><Logo tone="white" mark width={28} /></span>
            <div className="hidden xl:block">
              <Logo tone="white" width={112} />
              <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-white/60">Body shop rentals</div>
            </div>
          </div>
          <nav className="mt-2 flex flex-col gap-0.5 px-2">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                title={n.label}
                className={({ isActive }) => `relative flex h-9 items-center gap-3 rounded-[6px] px-2.5 text-[13px] transition-colors duration-150 ${isActive ? 'bg-white/12 text-white before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-white' : 'text-white/70 hover:bg-white/8 hover:text-white'}`}
              >
                <n.icon size={18} strokeWidth={1.5} className="shrink-0" />
                <span className="hidden flex-1 truncate xl:inline">{n.label}</span>
                {n.to === '/today' && openTasks > 0 && <span className={`num hidden text-[11px] xl:inline ${overdueOpen ? 'text-[#FFB4B4]' : 'text-white/70'}`}>{openTasks}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto hidden px-5 pb-4 text-[11px] text-white/50 xl:block">TSD read-only · hourly</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
          {/* Top bar 48px */}
          <header className="no-print sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-line bg-bg0/95 px-4 backdrop-blur-none md:px-6">
            <span className="md:hidden"><Logo tone={theme === 'dark' ? 'white' : 'blue'} mark width={22} /></span>
            <h1 className="display text-[20px] leading-none text-text0">{title}</h1>
            <div className="ml-auto flex items-center gap-1">
              <span className="hidden items-center gap-1.5 pr-2 text-[12px] text-text1 sm:flex" title={status?.fetchedAt ? `TSD data fetched ${new Date(status.fetchedAt).toLocaleString()}` : 'No TSD data yet'}>
                <StatusDot tone={fresh.tone} />
                <span className="text-text2">TSD</span>
                <span className="num text-text0">{fresh.time}</span>
                {status?.source === 'sample' && <span className="chip chip-warn ml-1">sample</span>}
                {status?.stale && <span className="chip chip-serious ml-1">older than 24h</span>}
              </span>
              <IconButton label="Refresh tasks from the latest TSD data" onClick={onRefresh} disabled={busy}><RefreshCw size={16} strokeWidth={1.5} className={busy ? 'animate-spin' : ''} /></IconButton>
              <IconButton label={theme === 'dark' ? 'Switch to Paper (light)' : 'Switch to dark'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}</IconButton>
              <RDropdown.Root>
                <RDropdown.Trigger asChild>
                  <button className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-on-brand hover:bg-brand-bright" aria-label="Account" title={me?.email}>{initials}</button>
                </RDropdown.Trigger>
                <RDropdown.Portal>
                  <RDropdown.Content align="end" sideOffset={6} className="panel z-50 min-w-[200px] py-1 text-[13px]" style={{ boxShadow: 'var(--shadow)' }}>
                    <div className="px-3 py-2 text-text1"><div className="text-text0">{me?.name}</div><div className="truncate text-[12px]">{me?.email}{me?.isAdmin ? ' · admin' : ''}</div></div>
                    <RDropdown.Separator className="my-1 h-px bg-line" />
                    <RDropdown.Item className="flex h-8 cursor-pointer items-center px-3 outline-none data-[highlighted]:bg-brand-tint" onSelect={() => setChangingPw(true)}>Change password</RDropdown.Item>
                    <RDropdown.Item className="flex h-8 cursor-pointer items-center px-3 outline-none data-[highlighted]:bg-brand-tint" onSelect={() => void signOut()}>Sign out</RDropdown.Item>
                  </RDropdown.Content>
                </RDropdown.Portal>
              </RDropdown.Root>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 md:px-6">
            <div className="print-only mb-4 flex items-center justify-between border-b border-line pb-3">
              <Logo tone="blue" width={120} />
              <div className="text-[11px] text-text1">Body shop rentals · {title} · {today}</div>
            </div>
            {error && <div className="mb-4 rounded-[6px] border border-danger/40 bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</div>}
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<TodayPage />} />
              <Route path="/active" element={<ActivePage />} />
              <Route path="/overdue" element={<OverduePage />} />
              <Route path="/balances" element={<BalancesPage />} />
              <Route path="/collections" element={<CollectionsPage />} />
              <Route path="/reports/*" element={<ReportsPage />} />
              <Route path="/shift" element={<ShiftPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </main>

          {/* Mobile bottom tab bar: 5 items + More */}
          <nav className="no-print fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch border-t border-line bg-bg1 md:hidden">
            {NAV.slice(0, 5).map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${isActive ? 'text-brand-bright' : 'text-text1'}`}>
                <n.icon size={18} strokeWidth={1.5} />{n.label.split(' ')[0]}
              </NavLink>
            ))}
            <RDropdown.Root>
              <RDropdown.Trigger asChild>
                <button className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-text1" aria-label="More"><MoreHorizontal size={18} strokeWidth={1.5} />More</button>
              </RDropdown.Trigger>
              <RDropdown.Portal>
                <RDropdown.Content side="top" align="end" sideOffset={8} className="panel z-50 min-w-[180px] py-1 text-[13px]" style={{ boxShadow: 'var(--shadow)' }}>
                  {NAV.slice(5).map((n) => (
                    <RDropdown.Item key={n.to} asChild className="flex h-9 cursor-pointer items-center gap-2 px-3 outline-none data-[highlighted]:bg-brand-tint">
                      <NavLink to={n.to}><n.icon size={16} strokeWidth={1.5} />{n.label}</NavLink>
                    </RDropdown.Item>
                  ))}
                </RDropdown.Content>
              </RDropdown.Portal>
            </RDropdown.Root>
          </nav>
        </div>
        <RentalDrawer />
        <Toast message={toast} />
      </div>
    </TooltipProvider>
  );
}
