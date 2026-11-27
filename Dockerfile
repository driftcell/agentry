# syntax=docker/dockerfile:1

FROM oven/bun:1.4.5 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN mkdir -p /app/crates/server/static && bun run build

FROM lukemathwalker/cargo-chef:latest-rust-1.100.0-trixie AS chef
WORKDIR /app
ENV CARGO_INCREMENTAL=0

FROM chef AS planner
RUN --mount=type=bind,target=. \
    cargo chef prepare --recipe-path /app/recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --bin agentry --recipe-path recipe.json
COPY --exclude=web --exclude=docker-compose*.yml --exclude=Dockerfile* --exclude=README.md . .
RUN cargo build --release --bin agentry

FROM debian:trixie-slim AS runtime
RUN <<'EOF'
set -eu
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
rm -rf /var/lib/apt/lists/*
groupadd --system --gid 10001 agentry
useradd --system --uid 10001 --gid agentry --home-dir /app agentry
EOF
WORKDIR /app
COPY --link --from=builder /app/target/release/agentry /usr/local/bin/agentry
COPY --link --from=web /app/crates/server/static /app/static
ENV STATIC_DIR=/app/static
USER agentry
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/agentry"]
