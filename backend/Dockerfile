# Production Dockerfile
# GPIO control is handled by a Python service running on the host
# The backend calls the GPIO service via HTTP, no GPIO libraries needed in container
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Build dependencies for native modules (prisma)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install --frozen-lockfile

# Generate Prisma client
RUN bunx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN bun run build

# Production image
FROM oven/bun:1-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files and install production deps only
COPY package.json bun.lock* ./
COPY prisma ./prisma/
RUN bun install --frozen-lockfile --production

# Generate Prisma client
RUN bunx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# Run as non-root user for security (no GPIO device access needed)
# The 'bun' user exists in oven/bun images
USER bun

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
