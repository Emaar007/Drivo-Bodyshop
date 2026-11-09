# Optional: run the TSD -> dashboard puller as a container instead of with setup.sh.
# Build from the repository root:
#   docker build -f deploy/puller/Dockerfile -t drivo-bodyshop-push .
# Run once (schedule it hourly with cron, a Kubernetes CronJob, etc.):
#   docker run --rm --env-file /etc/drivo-bodyshop-push.env drivo-bodyshop-push
#   docker run --rm --env-file /etc/drivo-bodyshop-push.env drivo-bodyshop-push --check
# Note: Docker's --env-file takes values literally, so do NOT wrap values in quotes there.
# The host's public IP must be on the TSD Azure SQL firewall.
FROM python:3.12-slim

WORKDIR /app
COPY deploy/puller/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY scripts/tsd/push_bodyshop.py scripts/tsd/bodyshop.sql ./

USER nobody
ENTRYPOINT ["python", "-I", "/app/push_bodyshop.py"]
