# IT handover: the TSD data puller

**Status (2026-11-09):** the dashboard gets no new data. The server that used to pull data from TSD
(DigitalOcean droplet `143.244.161.163`) belongs to a third party and is no longer used. This guide sets up a
replacement on a server you control. Expect about an hour, plus however long it takes to get the IP allow-listed.

## What the puller does

```
TSD database (Azure SQL)  --read-only SELECTs-->  PULLER (your server, fixed IP)  --HTTPS POST-->  Dashboard (Cloudflare)
azure-sql-tsd-drivo.database.windows.net           scripts/tsd/push_bodyshop.py                    /api/ingest
database 42295, port 1433                          hourly at :15                                   bearer token
```

- The TSD database only accepts connections from IP addresses on its **Azure SQL firewall** allow-list. The
  dashboard runs on Cloudflare Workers, which have no fixed IP, so it cannot connect itself. A small server
  with a fixed IP does the pulling and sends the result to the dashboard.
- Every hour the puller runs one SQL file (`scripts/tsd/bodyshop.sql`, 8 result sets, body shop rentals since
  Dec 2025, a few MB of JSON) and POSTs it to the dashboard. A run takes 1-8 minutes, almost all of it one
  table scan on the TSD side.
- **It never writes to TSD.** The SQL file has SELECTs only (plus temp tables), the connection is opened
  read-only, the script refuses to run if a write statement appears, and `tests/tsd-readonly.test.ts`
  fails the build if anyone adds one.
- The dashboard itself (Cloudflare Worker + D1 database) is already deployed and needs no changes. It
  rebuilds the day's task list every morning from the latest data it has received.

## What you need before you start

| # | Item | Notes |
|---|---|---|
| 1 | **A Linux server with a fixed public IP** | Ubuntu 22.04/24.04 or Debian 12. The smallest size is plenty (1 vCPU, 512 MB-1 GB RAM). A cloud VM (about $4-6/month) is the simplest option. An on-site machine works if the office has a static IP. Docker and Windows options are below. |
| 2 | **Outbound network access** | TCP **1433** to `azure-sql-tsd-drivo.database.windows.net` (Azure SQL may also redirect to other Azure hosts on 11000-11999; allow those if outbound traffic is filtered). TCP **443** to the dashboard URL. No inbound ports are needed. |
| 3 | **The server's IP on the TSD Azure SQL firewall** | Whoever administers that Azure SQL server adds it. That is probably TSD support, unless Drivo has Azure admin access itself. Ask at the same time for the old IP `143.244.161.163` to be **removed** (see "Security clean-up"). |
| 4 | **TSD SQL credentials** | Ask TSD for a **read-only** login (example request below). Until then the existing `tsddrivoadmin` login works, but it has full write access. |
| 5 | **Dashboard URL** | For example `https://bodyshop.drivorental.workers.dev` or a custom domain. |
| 6 | **Access to the Cloudflare account** that hosts the dashboard | Needed once, to set a new ingest token (step 3 below). The old token sits on the third-party server, so replace it. |

## Install (Ubuntu / Debian)

### 1. Get the code onto the server

```bash
sudo apt-get install -y git
git clone https://github.com/emaar7/Drivo-Bodyshop.git drivo-bodyshop
cd drivo-bodyshop
```

The repository is private. Use a GitHub account with access, or copy the folder over with `scp`. The puller
needs only `scripts/tsd/` and `deploy/puller/`.

### 2. Run the installer

```bash
sudo bash deploy/puller/setup.sh
```

The installer:

- Installs Python and creates a system user `drivo-push` with no login shell.
- Copies the puller to `/opt/drivo-bodyshop-push/` with its own Python environment (`pymssql` driver).
- Installs the command `/usr/local/bin/drivo-bodyshop-push`.
- Creates the settings file `/etc/drivo-bodyshop-push.env` (root:drivo-push, mode 640).
- Installs a systemd service and an hourly timer. The timer stays off until the settings are filled in.
- Prints the server's public IP. That is the address that must be on the Azure firewall.

You can run the installer again at any time, for example after `git pull`. It updates the code and never
overwrites the settings file.

### 3. Create a new ingest token for the dashboard

The ingest token is a shared password. The puller sends it with every upload, and the dashboard rejects
uploads without it. Create a new one and set it on the dashboard. From any machine with Node.js and this
repository:

```bash
openssl rand -hex 32
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put INGEST_TOKEN
```

Paste the value from `openssl` when prompted. The old token stops working right away. Keep the value for step 4.
Store it in your password manager, because Cloudflare will not show it again.

### 4. Fill in the settings

```bash
sudo nano /etc/drivo-bodyshop-push.env
```

Replace every `CHANGE_ME`:

| Setting | Value |
|---|---|
| `TSD_SQL_USER`, `TSD_SQL_PASS` | The TSD SQL login (read-only if TSD provided one) |
| `BODYSHOP_API` | Dashboard URL, no trailing slash |
| `BODYSHOP_INGEST_TOKEN` | The token from step 3 |

The file is read by `/bin/sh`. Wrap any value that contains spaces, `$`, `#`, quotes or backslashes in single
quotes, for example `TSD_SQL_PASS='p@ss$word#1'`.

### 5. Test the TSD connection (takes a few seconds, reads no rental data)

```bash
sudo drivo-bodyshop-push --check
```

The expected output is `TSD connection OK: database 42295, login ..., 74 sources visible`. If it fails, the
message says whether the cause is the firewall, the login or the network (see "Troubleshooting").

### 6. Start the hourly timer and run once now

```bash
sudo bash deploy/puller/setup.sh
```

```bash
sudo systemctl start drivo-bodyshop-push.service
```

```bash
journalctl -u drivo-bodyshop-push -n 20 --no-pager
```

The `start` command waits until the run finishes, which takes 1-8 minutes. A good run logs two lines:

```
fetched in 74.2s: {'rentals': 190, 'splits': ..., 'charges': ...}
pushed: 200 {"ok":true,"ingestId":...,"rentals":190,"tasksCreated":...,"today":"2026-11-09"}
```

Then open the dashboard. The header should show **"Data updated"** with the current time, and the
stale-data warning should be gone.

## Day-to-day

| Task | Command |
|---|---|
| When is the next run? | `systemctl list-timers drivo-bodyshop-push.timer` |
| Last runs and errors | `journalctl -u drivo-bodyshop-push --since today --no-pager` |
| Run now | `sudo systemctl start drivo-bodyshop-push.service` |
| Pull to a file without sending (for inspection) | `sudo drivo-bodyshop-push --out /tmp/payload.json` (contains customer names and phones: delete it afterwards, never commit it) |
| Update the code | `cd drivo-bodyshop && git pull && sudo bash deploy/puller/setup.sh` |
| Stop it | `sudo systemctl disable --now drivo-bodyshop-push.timer` |

The dashboard warns users when its data is more than 24 hours old. For alerting, monitor that the service's
last run succeeded, for example `systemctl is-failed drivo-bodyshop-push.service` returning `failed`.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| `... not on the TSD Azure SQL firewall` (Azure error 40615) | The server's public IP is not allow-listed. Send the IP printed by `setup.sh` to the Azure SQL admin. Rules can take up to 5 minutes to apply. |
| `wrong TSD_SQL_USER / TSD_SQL_PASS` (error 18456) | The login or password is wrong, or the login is disabled. Check the quoting in the settings file. |
| `cannot reach the database` (error 20009) | DNS or outbound TCP 1433 is blocked, or the IP is blocked at the firewall. Test with `nc -vz azure-sql-tsd-drivo.database.windows.net 1433`. |
| `TSD_SQL_PASS is not set` / `BODYSHOP_API ... not set` | The settings file is incomplete, or it was run without `sudo`. |
| `HTTP Error 401: Unauthorized` | `BODYSHOP_INGEST_TOKEN` does not match the Worker secret `INGEST_TOKEN`. Repeat steps 3-4. |
| `HTTP Error 403` / Cloudflare error 1010 | Cloudflare's bot protection blocked the upload. The script already sends its own User-Agent. If a WAF rule or Cloudflare Access was added in front of the dashboard, exempt the path `/api/ingest`. |
| `HTTP Error 400 ... payload shape not recognised` | The SQL file and the dashboard code are from different versions. Pull the latest code and rerun `setup.sh`. |
| `expected 8 result sets, got N` | The SQL file was edited or a TSD table changed. See `docs/tsd-schema.md`. |
| Run is killed after 45 minutes | The TSD side is very slow (the `Cpay` table scan). Raise `TimeoutStartSec` in the service file, or ask TSD about the database tier. |

## Other ways to run it

**Docker.** Build from the repository root and schedule `docker run` hourly (cron, a Kubernetes CronJob, etc.):

```bash
docker build -f deploy/puller/Dockerfile -t drivo-bodyshop-push .
```

```bash
docker run --rm --env-file /etc/drivo-bodyshop-push.env drivo-bodyshop-push --check
```

Docker's `--env-file` takes values literally, so do not quote them there. The host's public IP is the one
that needs to be on the Azure firewall.

**Windows** (a server with a static IP): install Python 3.12+, then `py -m pip install -r deploy\puller\requirements.txt`.
Set the variables from `deploy/puller/puller.env.example` as system environment variables, or in a `.bat`
file that sets them, and create a Task Scheduler job that runs
`py -I C:\path\to\scripts\tsd\push_bodyshop.py` hourly at :15, whether or not a user is logged on.

## Security clean-up (do once the new puller works)

The old server is controlled by a third party and still holds Drivo's TSD credentials.

1. **Remove `143.244.161.163` from the TSD Azure SQL firewall** (ask whoever added the new IP).
2. **Replace the ingest token.** Step 3 above does this. The old token stops working.
3. **Change the TSD SQL password, or better, switch to a read-only login** and disable `tsddrivoadmin` for
   this use. Either way, the credentials on the old server stop working.

### Example request to TSD for a read-only login

> Please create a read-only SQL login for Drivo's reporting on database `42295` (server
> `azure-sql-tsd-drivo.database.windows.net`), and allow-list our server IP `<NEW IP>` on the Azure SQL
> firewall. Please also remove `143.244.161.163` from the firewall. It no longer belongs to us.
>
> For your DBA, one way to do it (a contained database user, run in database 42295):
> ```sql
> CREATE USER drivo_bodyshop_reader WITH PASSWORD = '<strong password>';
> ALTER ROLE db_datareader ADD MEMBER drivo_bodyshop_reader;
> ```
> We only run SELECT statements (and our own `#temp` tables, which need no extra rights).

With a contained user like this, `TSD_SQL_USER` is the user name and `TSD_SQL_DB` stays `42295`.

## Where things are

| Path | What |
|---|---|
| `scripts/tsd/push_bodyshop.py` | The puller (Python 3, `pymssql`). `--check`, `--out FILE`, `--url`, `--token`, `--since` |
| `scripts/tsd/bodyshop.sql` | The only code that talks to TSD. SELECTs only |
| `deploy/puller/` | Installer, settings template, systemd service and timer, Dockerfile |
| `docs/tsd-schema.md` | What we know about the TSD tables |
| `src/worker/index.ts` | The dashboard's `/api/ingest` endpoint (checks the token, stores the data, rebuilds snapshot and tasks) |
| `README.md` | Dashboard development and deployment |
