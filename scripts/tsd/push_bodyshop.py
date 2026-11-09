#!/usr/bin/env python3
"""
push_bodyshop.py - TSD (Azure SQL) -> bodyshop dashboard Worker (/api/ingest).

READ-ONLY against TSD: runs scripts/tsd/bodyshop.sql (SELECTs only) and POSTs the
result as JSON to the dashboard. Runs on the puller server (its IP is on the Azure SQL
firewall list) from cron, and locally for development with --out / --url.

Environment:
  TSD_SQL_SERVER   default azure-sql-tsd-drivo.database.windows.net
  TSD_SQL_DB       default 42295          (the TSD customer database)
  TSD_SQL_USER     default tsddrivoadmin
  TSD_SQL_PASS     required
  BODYSHOP_API     e.g. https://bodyshop.<account>.workers.dev  (or --url)
  BODYSHOP_INGEST_TOKEN  shared secret, sent as Authorization: Bearer  (or --token)
  BODYSHOP_SINCE   first pickup date to include, default 2025-12-01

Usage:
  push_bodyshop.py --check         # only test the TSD login and firewall (a few seconds), no data
  push_bodyshop.py                 # fetch and POST to $BODYSHOP_API/api/ingest
  push_bodyshop.py --out payload.json   # fetch and write the payload (no POST)
  push_bodyshop.py --url http://localhost:5173 --token dev
"""
import argparse
import datetime as dt
import decimal
import json
import os
import sys
import time
import urllib.request

import pymssql

HERE = os.path.dirname(os.path.abspath(__file__))
SECTIONS = ["rentals", "splits", "money", "companies", "extensions", "notes", "employees", "charges"]


def to_json_value(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d %H:%M:%S") if isinstance(v, dt.datetime) else v.isoformat()
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    if isinstance(v, str):
        return v.strip()
    return v


def connect():
    """Open a read-only connection to TSD. Returns (conn, database name)."""
    server = os.environ.get("TSD_SQL_SERVER", "azure-sql-tsd-drivo.database.windows.net")
    db = os.environ.get("TSD_SQL_DB", "42295")
    user = os.environ.get("TSD_SQL_USER", "tsddrivoadmin")
    pw = os.environ.get("TSD_SQL_PASS")
    if not pw:
        sys.exit("TSD_SQL_PASS is not set")
    # read-only intent at the connection level too (older pymssql builds lack the flag; the SQL
    # file is SELECT-only either way and the guard in fetch() refuses write statements)
    kw = dict(server=server, user=user, password=pw, database=db, login_timeout=30, timeout=1800, as_dict=True)
    try:
        try:
            return pymssql.connect(read_only=True, **kw), db
        except TypeError:
            return pymssql.connect(**kw), db
    except pymssql.OperationalError as e:
        msg = str(e)
        if "40615" in msg or "not allowed to access the server" in msg:
            hint = "this server's public IP is not on the TSD Azure SQL firewall"
        elif "18456" in msg or "Login failed" in msg:
            hint = "wrong TSD_SQL_USER / TSD_SQL_PASS (or the login is disabled)"
        elif "20009" in msg or "unavailable or does not exist" in msg:
            hint = ("cannot reach the database: check TSD_SQL_SERVER, DNS and that outbound TCP port 1433 "
                    "is open (a blocked IP on the Azure firewall can also look like this)")
        else:
            hint = "see the error above"
        sys.exit(f"TSD connection FAILED to {server} / {db} as {user}: {hint}\n  detail: {msg.strip()}")


def check():
    """Connectivity test for the firewall / login: one tiny SELECT, no rental data."""
    conn, db = connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT DB_NAME() AS db, SUSER_NAME() AS login, COUNT(*) AS n FROM Csource")
        r = cur.fetchone()
        print(f"TSD connection OK: database {r['db']}, login {r['login']}, {r['n']} sources visible")
    finally:
        conn.close()


def fetch(since: str):

    with open(os.path.join(HERE, "bodyshop.sql"), encoding="utf-8") as f:
        sql = f.read().replace("$(SINCE)", since)
    if any(w in sql.upper() for w in (" INSERT ", " UPDATE ", " DELETE ", " MERGE ", " EXEC ", " ALTER ", " TRUNCATE ")):
        # Belt and braces: the SQL file must stay read-only (temp tables excepted).
        sys.exit("bodyshop.sql contains a write statement; refusing to run")

    started = time.time()
    conn, db = connect()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        out = {}
        i = 0
        while True:
            if cur.description:  # a result set (the temp-table SELECT INTO yields none)
                rows = cur.fetchall()
                out[SECTIONS[i]] = [{k: to_json_value(v) for k, v in r.items()} for r in rows]
                i += 1
            if not cur.nextset():
                break
        if i != len(SECTIONS):
            sys.exit(f"expected {len(SECTIONS)} result sets, got {i}")
    finally:
        conn.close()

    return {
        "source": "tsd",
        "database": db,
        "since": since,
        "fetchedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "durationSec": round(time.time() - started, 1),
        **out,
    }


def post(url: str, token: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url.rstrip("/") + "/api/ingest", data=body, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {token}",
                                          # Cloudflare's browser integrity check rejects "Python-urllib" (error 1010)
                                          "User-Agent": "drivo-bodyshop-push/1.0 (+https://github.com/drivo)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=os.environ.get("BODYSHOP_SINCE", "2025-12-01"))
    ap.add_argument("--check", action="store_true", help="only test the TSD connection, then exit")
    ap.add_argument("--out", help="write payload JSON here instead of posting")
    ap.add_argument("--url", default=os.environ.get("BODYSHOP_API"))
    ap.add_argument("--token", default=os.environ.get("BODYSHOP_INGEST_TOKEN"))
    a = ap.parse_args()

    if a.check:
        check()
        return

    payload = fetch(a.since)
    counts = {k: len(payload[k]) for k in SECTIONS}
    print(f"fetched in {payload['durationSec']}s: {counts}")

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        print(f"wrote {a.out}")
        return
    if not a.url or not a.token:
        sys.exit("BODYSHOP_API / BODYSHOP_INGEST_TOKEN not set (or use --out)")
    status, text = post(a.url, a.token, payload)
    print(f"pushed: {status} {text[:300]}")


if __name__ == "__main__":
    main()
