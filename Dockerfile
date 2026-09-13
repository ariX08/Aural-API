# Verome API — Deno on Docker (Render / Railway / Fly)
# Use a recent Deno that supports lockfile version 5+
FROM denoland/deno:2.4.5

WORKDIR /app

# Copy project (lock may be from a newer Deno; we regenerate if needed)
COPY deno.json ./
COPY deno.lock* ./
COPY main.ts ui.ts ./
COPY src ./src
COPY assets ./assets

# Cache deps. If lockfile is incompatible, recreate it then cache.
RUN deno cache main.ts || (rm -f deno.lock && deno cache --reload main.ts)

ENV PORT=8000
EXPOSE 8000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
