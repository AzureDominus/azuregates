#!/bin/bash
# System Maintenance Script for Raspberry Pi
# Runs weekly to keep the system updated and healthy
# Called by systemd timer: system-maintenance.timer

set -euo pipefail

LOG_TAG="system-maintenance"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    logger -t "$LOG_TAG" "$*"
}

log "Starting system maintenance..."

# Update package lists
log "Updating package lists..."
apt-get update -qq

# Upgrade installed packages (non-interactive, keep existing configs)
log "Upgrading packages..."
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold"

# Clean up old packages
log "Cleaning up..."
apt-get autoremove -y -qq
apt-get autoclean -qq

# Clean old journal logs (keep last 30 days)
log "Cleaning journal logs..."
journalctl --vacuum-time=30d --quiet

# Clean Docker resources (unused images, networks, build cache)
log "Cleaning Docker resources..."
docker system prune -f --filter "until=720h" || true
# Check disk space
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
log "Disk usage: ${DISK_USAGE}%"

if [ "$DISK_USAGE" -gt 85 ]; then
    log "WARNING: Disk usage is above 85%!"
fi

# Check memory
MEM_AVAILABLE=$(free -m | awk 'NR==2 {printf "%.0f", $7/$2*100}')
log "Memory available: ${MEM_AVAILABLE}%"

# Report kernel version
log "Kernel: $(uname -r)"

log "System maintenance completed successfully"
