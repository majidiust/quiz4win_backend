# Quiz4Win — service-monitor container
#
# A standalone Deno loop that runs health checks every MONITOR_INTERVAL_MS and
# sends Brevo transactional email alerts when any dependency goes unhealthy.
# See monitor.ts for the full list of checks and environment variables.

FROM denoland/deno:alpine-2.3.3

# tini: PID 1 signal handling so SIGTERM cleanly stops the loop.
RUN apk add --no-cache tini ca-certificates

WORKDIR /opt/monitor

COPY email.ts   /opt/monitor/email.ts
COPY monitor.ts /opt/monitor/monitor.ts

# Pre-cache deps so the first run is instant (failure is non-fatal).
RUN deno cache /opt/monitor/monitor.ts || true

# Permissions:
#   --allow-env : all MONITOR_*, BREVO_API_KEY, SUPABASE_*, REDIS_*, etc.
#   --allow-net : HTTP health checks, TCP probes, Brevo SMTP API
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["deno", "run", "--allow-env", "--allow-net", "/opt/monitor/monitor.ts"]
