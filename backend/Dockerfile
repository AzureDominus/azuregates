# Production Dockerfile
# Using Debian slim instead of Alpine because opengpio requires libgpiodcxx (C++ bindings)
# which are not available in Alpine's packages
FROM node:24-slim AS builder

WORKDIR /app

# Add Debian sid repository for libgpiod 2.x with C++ bindings
# opengpio requires libgpiodcxx.so.2 which is only in libgpiod >= 2.x
RUN echo 'deb http://deb.debian.org/debian sid main' > /etc/apt/sources.list.d/sid.list && \
    apt-get update && \
    apt-get install -y -t sid python3 make g++ libgpiod-dev && \
    rm -rf /var/lib/apt/lists/*

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
FROM node:24-slim

WORKDIR /app

# Install dumb-init for proper signal handling
# Install libgpiod 2.x from sid for opengpio (GPIO via libgpiod)
RUN echo 'deb http://deb.debian.org/debian sid main' > /etc/apt/sources.list.d/sid.list && \
    apt-get update && \
    apt-get install -y dumb-init && \
    apt-get install -y -t sid python3 make g++ libgpiod-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
# Use --include=optional to ensure opengpio is installed
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev --include=optional && npm cache clean --force

# Remove build dependencies to reduce image size (keep libgpiod runtime libraries)
RUN apt-get update && apt-get remove -y make g++ libgpiod-dev && \
    apt-get install -y -t sid libgpiod3 && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Generate Prisma client
RUN npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# NOTE: Running as root is required for GPIO access on Raspberry Pi
# The container needs /dev/gpiochip0 device mount
# If not using GPIO, you can uncomment the lines below for security:
# RUN addgroup --gid 1001 nodejs && \
#     adduser --uid 1001 --gid 1001 --disabled-password nodejs
# USER nodejs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
