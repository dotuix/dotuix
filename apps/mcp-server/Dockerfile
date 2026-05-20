FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests (needed for workspace: protocol resolution)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY apps/mcp-server/package.json ./apps/mcp-server/

# Install deps (including dev, needed for building)
RUN pnpm install --filter @dotuix/mcp-server... --frozen-lockfile

# Copy and build source
COPY packages/core ./packages/core
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm --filter @dotuix/core build
RUN pnpm --filter @dotuix/mcp-server build

# Create a standalone deployment — pnpm resolves all workspace: deps and
# produces a real node_modules (no symlinks). @dotuix/core dist/ is included
# via its "files" field. All external deps are real copies, not symlinks.
RUN pnpm deploy --filter @dotuix/mcp-server --prod /standalone

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Self-contained node_modules from pnpm deploy — no symlinks, no missing deps
COPY --from=builder /standalone/node_modules ./node_modules
COPY --from=builder /standalone/package.json ./package.json
COPY --from=builder /app/apps/mcp-server/dist ./dist

ENV PORT=80
ENV NODE_ENV=production
EXPOSE 80

CMD ["node", "dist/index.js"]
