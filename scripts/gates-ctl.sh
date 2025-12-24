#!/bin/bash
# Gates Control Script
# Helper script for common Gates application operations

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/.."
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.prod.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    echo -e "${BLUE}Gates Control Script${NC}"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  start       - Start all services"
    echo "  stop        - Stop all services"
    echo "  restart     - Restart all services"
    echo "  status      - Show service status"
    echo "  logs        - Follow all logs"
    echo "  logs-api    - Follow backend API logs only"
    echo "  health      - Check application health"
    echo "  update      - Run update script"
    echo "  shell       - Open shell in backend container"
    echo "  db          - Open PostgreSQL shell"
    echo "  config      - Reload configuration"
    echo "  backup      - Backup config and database"
    echo "  gpio-test   - Test GPIO access"
    echo ""
}

check_docker() {
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: Docker Compose not available${NC}"
        exit 1
    fi
}

cmd_start() {
    echo -e "${GREEN}Starting Gates services...${NC}"
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" up -d
    echo -e "${GREEN}Services started${NC}"
}

cmd_stop() {
    echo -e "${YELLOW}Stopping Gates services...${NC}"
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" down
    echo -e "${GREEN}Services stopped${NC}"
}

cmd_restart() {
    echo -e "${YELLOW}Restarting Gates services...${NC}"
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" restart
    echo -e "${GREEN}Services restarted${NC}"
}

cmd_status() {
    echo -e "${BLUE}Gates Service Status${NC}"
    echo ""
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" ps
}

cmd_logs() {
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100
}

cmd_logs_api() {
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 backend
}

cmd_health() {
    echo -e "${BLUE}Checking Gates health...${NC}"
    echo ""
    
    # Check API health
    if curl -sf http://localhost/api/health > /dev/null 2>&1; then
        echo -e "API:       ${GREEN}✓ Healthy${NC}"
    else
        echo -e "API:       ${RED}✗ Unhealthy${NC}"
    fi
    
    # Check individual containers
    cd "$PROJECT_DIR"
    echo ""
    echo "Container Status:"
    docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"
}

cmd_update() {
    echo -e "${BLUE}Running Gates update...${NC}"
    "$SCRIPT_DIR/update.sh"
}

cmd_shell() {
    echo -e "${BLUE}Opening shell in backend container...${NC}"
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" exec backend /bin/sh
}

cmd_db() {
    echo -e "${BLUE}Opening PostgreSQL shell...${NC}"
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" exec postgres psql -U gates -d gates
}

cmd_config() {
    echo -e "${BLUE}Reloading configuration...${NC}"
    
    if curl -sf -X POST http://localhost/api/config/reload > /dev/null 2>&1; then
        echo -e "${GREEN}Configuration reloaded successfully${NC}"
    else
        echo -e "${RED}Failed to reload configuration${NC}"
        echo "Make sure the API is running and try again"
        exit 1
    fi
}

cmd_backup() {
    echo -e "${BLUE}Creating backup...${NC}"
    
    BACKUP_DIR="${PROJECT_DIR}/backup/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Backup config
    cp "${PROJECT_DIR}/config/gates.prod.yaml" "$BACKUP_DIR/" 2>/dev/null || true
    cp "${PROJECT_DIR}/.env" "$BACKUP_DIR/" 2>/dev/null || true
    
    # Backup database
    cd "$PROJECT_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U gates gates > "$BACKUP_DIR/database.sql" 2>/dev/null || true
    
    echo -e "${GREEN}Backup created at: $BACKUP_DIR${NC}"
}

cmd_gpio_test() {
    echo -e "${BLUE}Testing GPIO access...${NC}"
    
    cd "$PROJECT_DIR"
    
    # Check if gpiomem is available
    if [[ -e /dev/gpiomem ]]; then
        echo -e "GPIO Memory: ${GREEN}✓ Available${NC}"
    else
        echo -e "GPIO Memory: ${RED}✗ Not available${NC}"
        echo "  This is expected on non-Raspberry Pi systems"
    fi
    
    # Check if container has GPIO access
    echo ""
    echo "Checking container GPIO access..."
    if docker compose -f "$COMPOSE_FILE" exec backend ls -la /dev/gpiomem 2>/dev/null; then
        echo -e "Container:   ${GREEN}✓ Has GPIO access${NC}"
    else
        echo -e "Container:   ${YELLOW}⚠ No GPIO access (simulated mode)${NC}"
    fi
}

# Main
check_docker

case "${1:-}" in
    start)
        cmd_start
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart
        ;;
    status)
        cmd_status
        ;;
    logs)
        cmd_logs
        ;;
    logs-api)
        cmd_logs_api
        ;;
    health)
        cmd_health
        ;;
    update)
        cmd_update
        ;;
    shell)
        cmd_shell
        ;;
    db)
        cmd_db
        ;;
    config)
        cmd_config
        ;;
    backup)
        cmd_backup
        ;;
    gpio-test)
        cmd_gpio_test
        ;;
    *)
        usage
        exit 1
        ;;
esac
