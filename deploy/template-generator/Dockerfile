# Quiz4Win — template-generator
#
# Single-purpose container that runs a Deno loop every minute and calls the
# `generate_games_from_active_templates` Postgres RPC to spawn games from
# active templates. See generator.ts for full details.
#
# We use the official denoland image (same Deno runtime as the api service)
# so the team only has to learn one runtime.

FROM denoland/deno:alpine-1.46.3

# tini gives us PID 1 signal handling so SIGTERM cleanly stops the loop.
RUN apk add --no-cache tini ca-certificates

WORKDIR /opt/template-generator

COPY generator.ts /opt/template-generator/generator.ts

# Pre-cache the network/std deps so cold-start doesn't go to the network. The
# script only uses Web Fetch + Deno.* so there's nothing to cache yet, but
# leaving this as a hook for future deps (e.g. amqplib for RabbitMQ).
RUN deno cache /opt/template-generator/generator.ts || true

# Run with minimum permissions:
#   --allow-env  : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEMPLATE_GEN_INTERVAL_MS
#   --allow-net  : reach the Supabase REST endpoint
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["deno", "run", "--allow-env", "--allow-net", "/opt/template-generator/generator.ts"]
