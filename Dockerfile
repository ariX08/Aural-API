# Verome API — Deno on Docker (Render / Railway / Fly)
FROM denoland/deno:2.1.4

WORKDIR /app

# Cache dependencies first (better layer reuse)
COPY deno.json deno.lock ./
COPY main.ts ui.ts ./
COPY src ./src
COPY assets ./assets

# Download & cache remote deps
RUN deno cache main.ts

# Render/Railway inject PORT; default 8000
ENV PORT=8000
EXPOSE 8000

# Network + env + read for assets
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
