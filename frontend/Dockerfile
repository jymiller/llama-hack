# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────
# Stage 1: install dependencies
# ─────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-alpine AS deps
WORKDIR /app

# Install OS libs needed by snowflake-sdk native bindings
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# ─────────────────────────────────────────────────────────────
# Stage 2: build Next.js app (standalone output)
# ─────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Snowflake vars must be present at build time so API routes compile
ENV SNOWFLAKE_ACCOUNT=SFSEHOL-LLAMA_LOUNGE_HACKATHON_UCGALS
ENV SNOWFLAKE_USER=USER
ENV SNOWFLAKE_PASSWORD=sn0wf@ll
ENV SNOWFLAKE_DATABASE=RECONCILIATION
ENV SNOWFLAKE_SCHEMA=PUBLIC
ENV SNOWFLAKE_WAREHOUSE=DEFAULT_WH

RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 3: minimal production runner
# ─────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Snowflake credentials (hackathon demo — baked in for convenience)
ENV SNOWFLAKE_ACCOUNT=SFSEHOL-LLAMA_LOUNGE_HACKATHON_UCGALS
ENV SNOWFLAKE_USER=USER
ENV SNOWFLAKE_PASSWORD=sn0wf@ll
ENV SNOWFLAKE_DATABASE=RECONCILIATION
ENV SNOWFLAKE_SCHEMA=PUBLIC
ENV SNOWFLAKE_WAREHOUSE=DEFAULT_WH

RUN apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# standalone bundle + static assets
COPY --from=builder /app/public                        ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
