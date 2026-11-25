#!/usr/bin/env node
// Loads the latest TSD data into the dashboard running on this machine, without TSD access of your own.
//
// The corporate portal's server (corporate.drivo.com) is on the TSD Azure SQL firewall. Every hour at :20 it
// runs this repo's read-only puller (scripts/tsd/push_bodyshop.py + bodyshop.sql) and keeps the result. This
// script downloads that result with a private token and sends it to your local dashboard's /api/ingest,
// exactly as the puller would.
//
//   npm run dev                 # in one terminal
//   npm run tsd:pull            # in another
//
// Settings, from .dev.vars (gitignored) or the environment:
//   DRIVO_EXTRACT_TOKEN   required. Ask Rovsh; keep it out of git and chat.
//   DRIVO_EXTRACT_URL     default https://corporate.drivo.com/api/bodyshop/extract
//   INGEST_TOKEN          your local dashboard's ingest token (default dev-token)
//   USE_SAMPLE_DATA       must be false in .dev.vars, or the dashboard keeps showing the sample
// Options:
//   --url http://localhost:5173   where the dashboard runs
//   --out file.json               save the extract instead of sending it (it holds customer names and
//                                 phones: delete it afterwards, never commit it)
import { readFileSync, writeFileSync } from 'node:fs';

function devVars() {
  try {
    const vars = {};
    for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    return vars;
  } catch {
    return {};
  }
}

const vars = { ...devVars(), ...process.env };
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const source = vars.DRIVO_EXTRACT_URL || 'https://corporate.drivo.com/api/bodyshop/extract';
const token = vars.DRIVO_EXTRACT_TOKEN;
const target = (arg('--url') || 'http://localhost:5173').replace(/\/+$/, '');
const out = arg('--out');

if (!token) {
  console.error('DRIVO_EXTRACT_TOKEN is not set. Add it to .dev.vars (ask Rovsh for the value).');
  process.exit(1);
}
if (!out && /^true$/i.test(vars.USE_SAMPLE_DATA ?? '')) {
  console.warn('Note: USE_SAMPLE_DATA=true in .dev.vars, so the dashboard will keep showing the sample. Set it to false and restart npm run dev.');
}

const res = await fetch(source, { headers: { Authorization: `Bearer ${token}` } });
if (res.status === 401) {
  console.error('The portal refused the token (401). Check DRIVO_EXTRACT_TOKEN.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const writtenAt = res.headers.get('x-extract-written-at');
const body = await res.text();
const payload = JSON.parse(body);
const counts = ['rentals', 'money', 'notes', 'charges'].map((k) => `${Array.isArray(payload[k]) ? payload[k].length : 0} ${k}`).join(', ');
console.log(`Extract from TSD at ${payload.fetchedAt ?? writtenAt}: ${counts}`);

if (out) {
  writeFileSync(out, body);
  console.log(`Saved to ${out}. It holds customer details: delete it when done.`);
  process.exit(0);
}

const ingest = await fetch(`${target}/api/ingest`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vars.INGEST_TOKEN || 'dev-token'}` },
  body,
}).catch((e) => {
  console.error(`Could not reach the dashboard at ${target}. Is npm run dev running? (${e.message})`);
  process.exit(1);
});
const result = await ingest.text();
if (!ingest.ok) {
  console.error(`The dashboard refused it: ${ingest.status} ${result}`);
  process.exit(1);
}
console.log(`Loaded into ${target}: ${result}`);
