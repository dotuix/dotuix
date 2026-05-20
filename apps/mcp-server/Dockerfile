FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests (needed for workspace: protocol resolution)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/mcp-server/package.json ./apps/mcp-server/

# Install only production deps for the mcp-server (and its workspace deps)
RUN pnpm install --filter @dotuix/mcp-server... --frozen-lockfile

# Copy and build source
COPY packages/core ./packages/core
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm --filter @dotuix/core build
RUN pnpm --filter @dotuix/mcp-server build

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder /app/apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY --from=builder /app/apps/mcp-server/node_modules ./apps/mcp-server/node_modules

WORKDIR /app/apps/mcp-server

ENV PORT=80
ENV NODE_ENV=production
EXPOSE 80

CMD ["node", "dist/index.js"]
