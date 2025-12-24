# Production Dockerfile
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (rpi-io)
RUN apk add --no-cache python3 make g++ libgpiod libgpiod-dev

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including optional for TypeScript type checking)
RUN npm ci --include=optional

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
# Install build dependencies for native modules (rpi-io for GPIO via libgpiod)
RUN apk add --no-cache dumb-init python3 make g++ libgpiod libgpiod-dev

# Copy package files and install production deps only
# Use --include=optional to ensure rpi-io is installed
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev --include=optional && npm cache clean --force

# Remove build dependencies to reduce image size (keep libgpiod runtime library)
RUN apk del make g++ libgpiod-dev

# Generate Prisma client
RUN npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# NOTE: Running as root is required for GPIO access on Raspberry Pi
# The container needs /dev/gpiochip0 and /dev/gpiomem device mounts
# If not using GPIO, you can uncomment the lines below for security:
# RUN addgroup -g 1001 -S nodejs && \
#     adduser -S nodejs -u 1001
# USER nodejs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
