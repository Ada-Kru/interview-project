# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

WORKDIR /app
RUN chown node:node /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CDK_CLI_TELEMETRY=false \
    JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 \
    CI=true

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .

RUN npm run build \
    && chmod +x scripts/demo-entrypoint.sh \
    && mkdir -p /tmp/demo

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=300s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["scripts/demo-entrypoint.sh"]
