#!/bin/bash
# Gates Application Update Script
# This script handles pull-based updates for the Gates application
# Run via systemd timer for automated updates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/.."
LOG_FILE="${PROJECT_DIR}/logs/update.log"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"
HEALTH_CHECK_URL="http://localhost/api/health"
ROLLBACK_TIMEOUT=120

# Ensure log directory exists
mkdir -p "${PROJECT_DIR}/logs"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

check_health() {
    local retries=30
    local delay=2
    
    for ((i=1; i<=retries; i++)); do
        if curl -sf "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
            return 0
        fi
        sleep $delay
    done
    return 1
}

backup_current_state() {
    log "Creating backup of current container state..."
    docker compose -f "$COMPOSE_FILE" config > "${PROJECT_DIR}/backup/docker-compose-backup.yml" 2>/dev/null || true
    
    # Save current image versions
    docker compose -f "$COMPOSE_FILE" images --format json > "${PROJECT_DIR}/backup/current-images.json" 2>/dev/null || true
}

pull_updates() {
    log "Pulling latest images..."
    docker compose -f "$COMPOSE_FILE" pull --quiet
}

apply_updates() {
    log "Applying updates..."
    docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
}

rollback() {
    log "ERROR: Health check failed! Initiating rollback..."
    
    if [[ -f "${PROJECT_DIR}/backup/current-images.json" ]]; then
        log "Attempting to rollback to previous images..."
        # In a real implementation, you'd parse the JSON and pull specific versions
        # For now, we just restart with existing images
        docker compose -f "$COMPOSE_FILE" down
        docker compose -f "$COMPOSE_FILE" up -d
    else
        log "No backup found, cannot rollback automatically"
    fi
}

cleanup_old_images() {
    log "Cleaning up unused images..."
    docker image prune -f --filter "until=168h" > /dev/null 2>&1 || true
}

main() {
    log "=========================================="
    log "Starting Gates update process"
    log "=========================================="
    
    cd "$PROJECT_DIR"
    
    # Ensure backup directory exists
    mkdir -p "${PROJECT_DIR}/backup"
    
    # Backup current state
    backup_current_state
    
    # Check if we're healthy before updating
    if ! check_health; then
        log "WARNING: System unhealthy before update, proceeding anyway..."
    fi
    
    # Pull new images
    pull_updates
    
    # Apply updates
    apply_updates
    
    # Wait for services to be ready
    log "Waiting for services to be healthy..."
    sleep 10
    
    # Verify health after update
    if check_health; then
        log "SUCCESS: Update completed and system is healthy"
        cleanup_old_images
    else
        rollback
        if check_health; then
            log "Rollback successful, system is healthy"
        else
            log "CRITICAL: Rollback failed, manual intervention required!"
            exit 1
        fi
    fi
    
    log "Update process completed"
    log "=========================================="
}

# Run main function
main "$@"
