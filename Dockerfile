# ── Stage 1: Install all dependencies (including devDeps for build) ────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install Playwright/Chromium system dependencies
# (same list used by `playwright install-deps chromium`)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libdbus-1-3 libxcb1 libxkbcommon0 \
      libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
      libglib2.0-0 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# Copy production deps + compiled output
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist   ./dist
COPY --from=builder /app/public ./public

# Download Playwright's pinned Chromium binary into the image
RUN npx playwright install chromium

# Non-root user for security
RUN groupadd -r webbridge && useradd -r -g webbridge webbridge
RUN chown -R webbridge:webbridge /app
USER webbridge

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
