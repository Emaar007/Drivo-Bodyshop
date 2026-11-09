import { useEffect, useState } from 'react';
import type { User } from '@shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { formatIso } from '../format';
import { Chip, Field, Modal, Section, Spinner } from './ui';

function tempPassword(): string {
  const words = ['river', 'maple', 'stone', 'harbor', 'cedar', 'falcon', 'summit', 'meadow', 'copper', 'willow'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(100 + Math.random() * 900)}`;
}

export default function UsersAdmin({ onToast }: { onToast: (m: string) => void }) {
  const { me, rules } = useStore();
  const [users, setUsers] = useState<User[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: tempPassword(), isAdmin: false });
  const [reset, setReset] = useState<{ email: string; password: string } | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);

  const load = () => api.users().then(setUsers).catch((e) => onToast(e.message));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me?.isAdmin) return null;

  async function add() {
    try {
      await api.createUser(form);
      setShown({ email: form.email, password: form.password });
      setAdding(false);
      setForm({ email: '', name: '', password: tempPassword(), isAdmin: false });
      await load();
    } catch (e) { onToast(e instanceof Error ? e.message : 'Failed'); }
  }
  async function doReset() {
    if (!reset) return;
    try {
      await api.updateUser(reset.email, { password: reset.password });
      setShown(reset);
      setReset(null);
      await load();
    } catch (e) { onToast(e instanceof Error ? e.message : 'Failed'); }
  }
  async function patch(email: string, body: { isAdmin?: boolean; active?: boolean }) {
    try { await api.updateUser(email, body); await load(); } catch (e) { onToast(e instanceof Error ? e.message : 'Failed'); }
  }
  async function remove(email: string) {
    if (!confirm(`Delete the account ${email}? Their task history stays.`)) return;
    try { await api.deleteUser(email); await load(); } catch (e) { onToast(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Section title={`Users (${users?.length ?? '…'})`} className="mt-4" right={<button className="btn btn-sm" onClick={() => setAdding(true)}>+ Add user</button>}>
      <div className="px-4 pt-2 text-xs text-ink-3">Everyone here can sign in and work tasks. Admins can also edit Settings. New users and password resets get a temporary password they must change at first sign-in.</div>
      {users === null ? <Spinner /> : (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td className="font-medium">{u.name}{u.email === me.email && <span className="text-ink-3"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>{u.isAdmin ? <Chip tone="accent">admin</Chip> : <Chip tone="neutral">user</Chip>}</td>
                <td>{u.active ? <Chip tone="good">active</Chip> : <Chip tone="critical">disabled</Chip>}{u.mustChangePassword && <Chip tone="warn">temp password</Chip>}</td>
                <td className="text-xs text-ink-3">{u.lastLoginAt ? formatIso(u.lastLoginAt, rules.timezone) : 'never'}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => setReset({ email: u.email, password: tempPassword() })}>Reset password</button>
                  {u.email !== me.email && <>
                    <button className="btn btn-sm btn-ghost ml-1" onClick={() => patch(u.email, { isAdmin: !u.isAdmin })}>{u.isAdmin ? 'Make user' : 'Make admin'}</button>
                    <button className="btn btn-sm btn-ghost ml-1" onClick={() => patch(u.email, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>
                    <button className="btn btn-sm btn-ghost ml-1 text-critical" onClick={() => remove(u.email)}>Delete</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <Modal title="Add user" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-primary" disabled={!form.email || !form.name} onClick={add}>Create</button></>}>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Temporary password" hint="Share it with them; they must change it at first sign-in."><input className="input ra" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Admin (can edit Settings and users)</label>
        </Modal>
      )}
      {reset && (
        <Modal title={`Reset password for ${reset.email}`} onClose={() => setReset(null)} footer={<><button className="btn" onClick={() => setReset(null)}>Cancel</button><button className="btn btn-primary" onClick={doReset}>Reset</button></>}>
          <Field label="Temporary password" hint="They must change it at next sign-in."><input className="input ra" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /></Field>
        </Modal>
      )}
      {shown && (
        <Modal title="Share these sign-in details" onClose={() => setShown(null)} footer={<button className="btn btn-primary" onClick={() => setShown(null)}>Done</button>}>
          <div className="text-sm">Email: <strong>{shown.email}</strong></div>
          <div className="text-sm">Temporary password: <code className="rounded bg-surface-2 px-1.5 py-0.5 ra">{shown.password}</code></div>
          <div className="text-xs text-ink-3">This is shown once. The user will be asked to choose their own password when they sign in.</div>
        </Modal>
      )}
    </Section>
  );
}
