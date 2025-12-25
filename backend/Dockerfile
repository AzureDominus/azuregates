# Production Dockerfile
# GPIO control is handled by a Python service running on the host
# The backend calls the GPIO service via HTTP, no GPIO libraries needed in container
FROM node:24-alpine AS builder

WORKDIR /app

# Build dependencies for native modules (prisma)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build
RUN npm run build

# Production image
FROM node:24-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files and install production deps only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma client
RUN npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# Run as non-root user for security (no GPIO device access needed)
# Use UID 1000 to match the default 'pi' user on Raspberry Pi for config file access
RUN addgroup -g 1000 nodejs && \
    adduser -u 1000 -G nodejs -D nodejs
USER nodejs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
