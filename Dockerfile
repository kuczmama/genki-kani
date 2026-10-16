# Build the frontend
FROM node:22-alpine AS web
WORKDIR /app
COPY data ./data
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# Build the server
FROM rust:1-slim AS server
WORKDIR /app
COPY backend ./backend
RUN cd backend && cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=server /app/backend/target/release/genki-kani-server /usr/local/bin/
COPY --from=web /app/frontend/dist ./dist
ENV STATIC_DIR=/app/dist DATA_FILE=/data/genki-kani-progress.json PORT=3002
VOLUME /data
EXPOSE 3002
CMD ["genki-kani-server"]
