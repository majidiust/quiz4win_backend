# syntax=docker/dockerfile:1.7

FROM denoland/deno:alpine AS runner
WORKDIR /app

# Copy the entire functions tree (handlers + _shared + deno.json).
COPY . /app/functions

ENV PORT=8000
EXPOSE 8000

# Pre-cache deps (best-effort — skip on error so missing optional deps don't
# break the image build).
RUN deno cache --config /app/functions/deno.json /app/functions/_server.ts || true

CMD ["deno", "run", \
     "--allow-net", \
     "--allow-env", \
     "--allow-read", \
     "--allow-sys=osRelease", \
     "--config", "/app/functions/deno.json", \
     "/app/functions/_server.ts"]
