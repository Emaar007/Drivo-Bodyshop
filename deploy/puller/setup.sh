#!/bin/bash
# Installs (or updates) the TSD -> dashboard puller on an Ubuntu 22.04/24.04 or Debian 12 server.
#
#   git clone <this repo> && cd <repo>
#   sudo bash deploy/puller/setup.sh
#
# Safe to run again: it updates the scripts and Python packages, and never overwrites the
# settings file once it exists. See docs/IT-HANDOVER.md for the full procedure.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR=/opt/drivo-bodyshop-push
ENV_FILE=/etc/drivo-bodyshop-push.env
SVC_USER=drivo-push
UNIT=drivo-bodyshop-push

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/puller/setup.sh" >&2
  exit 1
fi
for f in scripts/tsd/push_bodyshop.py scripts/tsd/bodyshop.sql deploy/puller/requirements.txt; do
  [ -f "$REPO_DIR/$f" ] || { echo "missing $REPO_DIR/$f (run from a full checkout)" >&2; exit 1; }
done

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv ca-certificates >/dev/null

echo "==> Service user $SVC_USER"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC_USER"

echo "==> Copying the puller to $APP_DIR"
install -d -m 755 "$APP_DIR"
install -m 644 "$REPO_DIR/scripts/tsd/push_bodyshop.py" "$REPO_DIR/scripts/tsd/bodyshop.sql" \
  "$REPO_DIR/deploy/puller/requirements.txt" "$APP_DIR/"
install -m 755 "$REPO_DIR/deploy/puller/drivo-bodyshop-push" /usr/local/bin/drivo-bodyshop-push

echo "==> Python environment"
[ -x "$APP_DIR/venv/bin/python" ] || python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -q --disable-pip-version-check -r "$APP_DIR/requirements.txt"
"$APP_DIR/venv/bin/python" -c "import pymssql; print('    pymssql', pymssql.__version__)"

echo "==> Settings file $ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  echo "    exists, left unchanged"
else
  install -m 640 -o root -g "$SVC_USER" "$REPO_DIR/deploy/puller/puller.env.example" "$ENV_FILE"
  echo "    created from the template: fill it in"
fi
chown root:"$SVC_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

if [ -d /run/systemd/system ]; then
  echo "==> systemd service and hourly timer"
  install -m 644 "$REPO_DIR/deploy/puller/$UNIT.service" "$REPO_DIR/deploy/puller/$UNIT.timer" /etc/systemd/system/
  systemctl daemon-reload
  if grep -q CHANGE_ME "$ENV_FILE"; then
    systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
    TIMER_STATE="NOT started yet (settings still contain CHANGE_ME)"
  else
    systemctl enable --now "$UNIT.timer" >/dev/null
    TIMER_STATE="enabled: runs every hour at :15"
  fi
else
  TIMER_STATE="skipped: systemd is not running on this machine (schedule '/usr/local/bin/drivo-bodyshop-push' with cron instead)"
fi

cat <<EOF

Done.
  Timer:     $TIMER_STATE
  Settings:  $ENV_FILE
  Server IP: $(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "unknown (check with your provider)")  <- must be on the TSD Azure SQL firewall

Next steps:
  1. sudo nano $ENV_FILE                 # fill in every CHANGE_ME
  2. sudo drivo-bodyshop-push --check    # tests the TSD login and firewall
  3. sudo bash deploy/puller/setup.sh    # run again: starts the hourly timer
  4. sudo systemctl start $UNIT.service && journalctl -u $UNIT -n 20 --no-pager
EOF
