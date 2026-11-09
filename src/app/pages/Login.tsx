import { useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Field } from '../components/ui';
import { Logo } from '../ui/Logo';

export default function LoginPage() {
  const { auth, signIn, setup } = useStore();
  const isSetup = auth === 'setup';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSetup && password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      if (isSetup) await setup(email, name, password);
      else await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 pb-2">
          <Logo tone={document.documentElement.dataset.theme === 'light' ? 'blue' : 'white'} width={120} />
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-text2">Body shop rentals</div>
        </div>
        {isSetup ? (
          <div className="text-sm text-ink-2">
            <div className="font-medium text-ink">First-time setup</div>
            No accounts exist yet. Create the first admin account; you can add the rest of the team under Settings → Users.
          </div>
        ) : (
          <div className="text-sm text-ink-2">Sign in with your work email.</div>
        )}
        <Field label="Email"><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        {isSetup && <Field label="Your name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="Password" hint={isSetup ? 'At least 10 characters with a number.' : undefined}>
          <input className="input" type="password" autoComplete={isSetup ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {isSetup && <Field label="Confirm password"><input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>}
        {error && <div className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-sm text-critical">{error}</div>}
        <button className="btn btn-primary justify-center py-2" disabled={busy}>{busy ? 'Please wait…' : isSetup ? 'Create admin account' : 'Sign in'}</button>
        {!isSetup && <div className="text-xs text-ink-3">Forgot your password? Ask an admin to reset it under Settings → Users.</div>}
      </form>
    </div>
  );
}

export function ChangePasswordCard({ onDone, forced }: { onDone: () => void; forced: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    setError(null);
    try {
      const { api } = await import('../api');
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="sheet w-full max-w-sm p-6 flex flex-col gap-3">
      <div className="font-semibold">{forced ? 'Set a new password' : 'Change password'}</div>
      {forced && <div className="text-sm text-ink-2">An admin set a temporary password for you. Choose your own to continue.</div>}
      <Field label={forced ? 'Temporary password' : 'Current password'}><input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password" hint="At least 10 characters with a number."><input className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {error && <div className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-sm text-critical">{error}</div>}
      <button className="btn btn-primary justify-center py-2" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
