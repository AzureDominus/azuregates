# Production Dockerfile
# Using Alpine with libgpiod CLI tools (gpioset/gpioget)
# No native GPIO library compilation needed - we shell out to gpioset
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
# Install libgpiod for gpioset/gpioget CLI tools
RUN apk add --no-cache dumb-init libgpiod

# Copy package files and install production deps only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm cache clean --force

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
