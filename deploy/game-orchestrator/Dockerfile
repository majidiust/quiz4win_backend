# Quiz4Win — game-orchestrator
#
# Long-running Deno process that consumes game-lifecycle commands from
# RabbitMQ (AMQP), drives Redis game state, coordinates LLM question
# generation, broadcasts events via LiveKit, and persists results to Postgres.
#
# Uses the same Deno version as the api and template-generator services.

FROM denoland/deno:alpine-2.3.3

# tini for PID-1 signal forwarding (clean SIGTERM on docker stop).
RUN apk add --no-cache tini ca-certificates

WORKDIR /opt/game-orchestrator

# deno.json must be present before `deno cache` so the import map
# (jsr:@std/io → 0.224.9) is applied when resolving deno.land/x/amqp deps.
COPY deno.json      /opt/game-orchestrator/deno.json
COPY orchestrator.ts /opt/game-orchestrator/orchestrator.ts

# Pre-cache all dependencies at build time so cold-start is instant.
RUN deno cache \
      --node-modules-dir=auto \
      /opt/game-orchestrator/orchestrator.ts || true

ENTRYPOINT ["/sbin/tini", "--"]

# Permissions:
#   --allow-env  : REDIS_URL, RABBITMQ_URL, OPENAI_API_KEY, LIVEKIT_*, SUPABASE_*
#   --allow-net  : Redis, RabbitMQ, OpenAI API, LiveKit, Supabase REST
#   --allow-read : node_modules (npm: cache)
CMD ["deno", "run", \
     "--allow-env", "--allow-net", "--allow-read", \
     "--node-modules-dir=auto", \
     "/opt/game-orchestrator/orchestrator.ts"]
