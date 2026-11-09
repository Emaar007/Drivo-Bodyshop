import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api, type SettingsResponse } from '../api';
import { formatIso, nameFromEmail } from '../format';
import { Field, Modal, PageHeader, Section, Spinner, Toast, useToast } from '../components/ui';
import UsersAdmin from '../components/UsersAdmin';
import ExcludedCharges from '../components/ExcludedCharges';

export default function SettingsPage() {
  const { me, data, reload, rules, status } = useStore();
  const [s, setS] = useState<SettingsResponse | null>(null);
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<{ key: string; displayName: string; contact: string; phone: string; email: string; address: string } | null>(null);
  const [alias, setAlias] = useState({ alias: '', canonical: '', kind: 'bodyshop' as 'bodyshop' | 'insurer' });
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ dueSoonDays: '', staleExtensionDays: '', adminEmails: '' });

  async function load() {
    const r = await api.settings();
    setS(r);
    setForm({ dueSoonDays: String(r.rules.dueSoonDays), staleExtensionDays: String(r.rules.staleExtensionDays), adminEmails: r.adminEmails.join(', ') });
  }
  useEffect(() => { load().catch((e) => showToast(e.message)); // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  const shops = useMemo(() => (data?.lookups.bodyshops ?? []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const unmatched = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of data?.rentals ?? []) if (r.bodyshop && !r.bodyshop.matched) seen.set(r.bodyshop.name, (seen.get(r.bodyshop.name) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  if (!s) return <Spinner />;
  const admin = !!me?.isAdmin;

  async function saveRules() {
    try {
      await api.saveRules({ dueSoonDays: Number(form.dueSoonDays), staleExtensionDays: Number(form.staleExtensionDays), adminEmails: form.adminEmails });
      showToast('Rules saved');
      await Promise.all([load(), reload()]);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }
  async function saveContact() {
    if (!editing) return;
    try {
      await api.saveContact(editing.key, { displayName: editing.displayName, contact: editing.contact || null, phone: editing.phone || null, email: editing.email || null, address: editing.address || null });
      setEditing(null);
      showToast('Contact saved');
      await Promise.all([load(), reload()]);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }
  async function addAlias() {
    try {
      await api.saveAlias(alias);
      setAlias({ alias: '', canonical: '', kind: alias.kind });
      showToast('Alias saved');
      await Promise.all([load(), reload()]);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle={admin ? 'Rules, body shop contacts and name aliases. Changes apply to everyone immediately.' : 'Read-only: ask an admin to change rules or contacts.'} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Rules">
          <div className="flex flex-col gap-3 p-4 text-sm">
            <Field label="Due soon window (days)" hint="A rental still out with its drop-off within this many days becomes a 'due soon' task.">
              <input className="input w-32" type="number" min={0} disabled={!admin} value={form.dueSoonDays} onChange={(e) => setForm({ ...form, dueSoonDays: e.target.value })} />
            </Field>
            <Field label="Stale extension flag (days)" hint="Reserved for a future 'no extension in N days' data check.">
              <input className="input w-32" type="number" min={0} disabled={!admin} value={form.staleExtensionDays} onChange={(e) => setForm({ ...form, staleExtensionDays: e.target.value })} />
            </Field>
            <Field label="Extra admin emails" hint="Comma-separated, optional. Normally make someone an admin in the Users list below; this list is a fallback.">
              <input className="input" disabled={!admin} value={form.adminEmails} onChange={(e) => setForm({ ...form, adminEmails: e.target.value })} />
            </Field>
            <div className="text-xs text-ink-3">
              Timezone {rules.timezone}, priority order: {rules.priorityOrder.join(' → ')}, tax estimate while out: {Object.entries(rules.taxRateByLocation).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join(', ')} (config/rules.ts)
            </div>
            {admin && <div><button className="btn btn-primary" onClick={saveRules}>Save rules</button></div>}
          </div>
        </Section>

        <Section title="Data source">
          <div className="p-4 text-sm flex flex-col gap-1">
            <div>Source: <strong>{status?.source === 'sample' ? 'anonymised sample file' : 'TSD (Azure SQL, database 42295)'}</strong></div>
            <div>Last fetch: <strong>{status?.fetchedAt ? formatIso(status.fetchedAt, rules.timezone) : '—'}</strong>{status?.stale && <span className="ml-2 chip chip-critical">older than 24h</span>}</div>
            <div>Records in the extract: <strong>{status?.rentalCount ?? data?.rentals.length ?? 0}</strong> (rentals since {data?.since || '—'}, plus after-rental charge records)</div>
            <div className="text-xs text-ink-3 mt-2">
              The droplet <code>drivo-push</code> runs <code>scripts/tsd/push_bodyshop.py</code> on a schedule: read-only SELECTs against TSD, pushed to this dashboard's <code>/api/ingest</code>.
              "Refresh now" rebuilds today's tasks from the latest push; it cannot query TSD itself (Cloudflare has no fixed IP for the Azure firewall).
            </div>
          </div>
        </Section>
      </div>

      <Section title={`Body shop contacts (${data?.lookups.bodyshops.length ?? 0} from TSD${s.contacts.length ? `, ${s.contacts.length} edited here` : ''})`} className="mt-4"
        right={<div className="flex gap-2"><input className="input w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />{admin && <button className="btn btn-sm" onClick={() => setEditing({ key: '', displayName: '', contact: '', phone: '', email: '', address: '' })}>+ Add</button>}</div>}>
        {unmatched.length > 0 && (
          <div className="mx-4 mt-3 rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">
            <strong>Unmatched body shop names on rentals:</strong> {unmatched.map(([n, c]) => `${n} (${c})`).join(', ')}. Add them as a contact or an alias below.
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th>Address</th>{admin && <th />}</tr></thead>
            <tbody>
              {shops.map((b) => {
                const edited = s.contacts.find((c) => c.key === b.key);
                return (
                  <tr key={b.key}>
                    <td className="font-medium">{b.name}{edited && <span className="ml-2 chip chip-accent" title={`edited by ${nameFromEmail(edited.updated_by)}`}>edited</span>}</td>
                    <td>{b.contact ?? <span className="text-ink-3">—</span>}</td>
                    <td className="num">{b.phone ?? <span className="text-ink-3">—</span>}</td>
                    <td className="break-all">{b.email ?? <span className="text-ink-3">—</span>}</td>
                    <td className="text-xs text-ink-2">{b.address ?? '—'}</td>
                    {admin && (
                      <td className="text-right whitespace-nowrap">
                        <button className="btn btn-sm" onClick={() => setEditing({ key: b.key, displayName: b.name, contact: b.contact ?? '', phone: b.phone ?? '', email: b.email ?? '', address: b.address ?? '' })}>Edit</button>
                        {edited && <button className="btn btn-sm btn-ghost ml-1" onClick={async () => { await api.deleteContact(b.key); await Promise.all([load(), reload()]); showToast('Override removed'); }}>Reset</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <ExcludedCharges />

      <UsersAdmin onToast={showToast} />

      <Section title="Name aliases" className="mt-4">
        <div className="p-4 text-sm">
          <div className="text-xs text-ink-3 mb-2">Map a raw TSD name to the name you want to see (e.g. STATEFARM → State Farm, NOVITEC → Novitec Auto Body). Built-in aliases live in <code>src/shared/config/</code>; these are added on top.</div>
          {admin && (
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <Field label="Raw name"><input className="input" value={alias.alias} onChange={(e) => setAlias({ ...alias, alias: e.target.value })} /></Field>
              <Field label="Show as"><input className="input" value={alias.canonical} onChange={(e) => setAlias({ ...alias, canonical: e.target.value })} /></Field>
              <Field label="Kind"><select className="select" value={alias.kind} onChange={(e) => setAlias({ ...alias, kind: e.target.value as 'bodyshop' | 'insurer' })}><option value="bodyshop">Body shop</option><option value="insurer">Insurer</option></select></Field>
              <button className="btn btn-primary" disabled={!alias.alias || !alias.canonical} onClick={addAlias}>Add alias</button>
            </div>
          )}
          {s.aliases.length === 0 ? <div className="text-ink-3">No custom aliases yet.</div> : (
            <table className="table">
              <thead><tr><th>Raw (normalised)</th><th>Shown as</th><th>Kind</th><th>By</th>{admin && <th />}</tr></thead>
              <tbody>
                {s.aliases.map((a) => (
                  <tr key={a.alias}><td className="ra text-xs">{a.alias}</td><td>{a.canonical}</td><td>{a.kind}</td><td className="text-xs text-ink-3">{nameFromEmail(a.updated_by)}</td>
                    {admin && <td className="text-right"><button className="btn btn-sm btn-ghost" onClick={async () => { await api.deleteAlias(a.alias); await Promise.all([load(), reload()]); }}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      {editing && (
        <Modal title={editing.key ? `Edit ${editing.displayName}` : 'Add body shop contact'} onClose={() => setEditing(null)} footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={!editing.displayName} onClick={saveContact}>Save</button></>}>
          <Field label="Name"><input className="input" value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} /></Field>
          <Field label="Contact person"><input className="input" value={editing.contact} onChange={(e) => setEditing({ ...editing, contact: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}
