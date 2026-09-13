# Verome API — Deno on Docker (Render / Railway / Fly)
FROM denoland/deno:2.9.6

WORKDIR /app

COPY deno.json ./
COPY deno.lock* ./
COPY main.ts ui.ts ./
COPY src ./src
COPY assets ./assets

# Cache deps; recreate lockfile if version mismatch
RUN deno cache main.ts || (rm -f deno.lock && deno cache --reload main.ts)

ENV PORT=8000
EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
