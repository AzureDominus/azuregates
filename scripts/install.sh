#!/bin/bash
# Gates Application Installation Script for Raspberry Pi
# This script sets up the Gates application on a fresh Raspberry Pi

set -e

INSTALL_DIR="/opt/gates"
REPO_URL="https://github.com/yourusername/gates.git"  # Replace with your repo

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_architecture() {
    ARCH=$(uname -m)
    if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" ]]; then
        log_warn "This script is designed for Raspberry Pi (ARM). Detected: $ARCH"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

install_docker() {
    if command -v docker &> /dev/null; then
        log_info "Docker already installed: $(docker --version)"
    else
        log_info "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
        
        # Add current user to docker group
        usermod -aG docker "$SUDO_USER" || true
        
        log_info "Docker installed successfully"
    fi
    
    # Ensure Docker starts on boot
    systemctl enable docker
    systemctl start docker
}

install_dependencies() {
    log_info "Installing system dependencies..."
    apt-get update
    apt-get install -y git curl avahi-daemon
    
    # Enable mDNS
    systemctl enable avahi-daemon
    systemctl start avahi-daemon
    
    log_info "Dependencies installed"
}

setup_gpio() {
    log_info "Configuring GPIO access..."
    
    # Add user to gpio group
    usermod -aG gpio "$SUDO_USER" || true
    
    # Create udev rule for GPIO access
    cat > /etc/udev/rules.d/99-gpio.rules << 'EOF'
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", ACTION=="add", PROGRAM="/bin/sh -c 'chown root:gpio /sys/class/gpio/export /sys/class/gpio/unexport ; chmod 220 /sys/class/gpio/export /sys/class/gpio/unexport'"
SUBSYSTEM=="gpio", KERNEL=="gpio*", ACTION=="add", PROGRAM="/bin/sh -c 'chown root:gpio /sys%p/active_low /sys%p/direction /sys%p/edge /sys%p/value ; chmod 660 /sys%p/active_low /sys%p/direction /sys%p/edge /sys%p/value'"
EOF
    
    udevadm control --reload-rules
    udevadm trigger
    
    log_info "GPIO configured"
}

clone_repository() {
    if [[ -d "$INSTALL_DIR" ]]; then
        log_info "Installation directory exists, pulling updates..."
        cd "$INSTALL_DIR"
        git pull origin main || git pull origin master
    else
        log_info "Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
}

setup_environment() {
    log_info "Setting up environment..."
    
    cd "$INSTALL_DIR"
    
    if [[ ! -f ".env" ]]; then
        log_info "Creating .env file from template..."
        cp .env.example .env
        
        # Generate random secrets
        POSTGRES_PASSWORD=$(openssl rand -hex 24)
        SESSION_SECRET=$(openssl rand -hex 32)
        AUTHENTIK_SECRET_KEY=$(openssl rand -hex 32)
        
        # Update .env with generated values
        sed -i "s/your-secure-password-here/$POSTGRES_PASSWORD/" .env
        sed -i "s/your-session-secret-min-32-chars/$SESSION_SECRET/" .env
        sed -i "s/your-authentik-secret-key-min-50-chars/$AUTHENTIK_SECRET_KEY/" .env
        
        log_warn "Generated random secrets in .env file"
        log_warn "Please review and update BASE_URL and other settings as needed"
    else
        log_info ".env file already exists, skipping..."
    fi
}

setup_systemd() {
    log_info "Setting up systemd services..."
    
    # Copy service files
    cp "$INSTALL_DIR/scripts/gates-update.service" /etc/systemd/system/
    cp "$INSTALL_DIR/scripts/gates-update.timer" /etc/systemd/system/
    
    # Update paths in service file
    sed -i "s|/opt/gates|$INSTALL_DIR|g" /etc/systemd/system/gates-update.service
    
    # Make update script executable
    chmod +x "$INSTALL_DIR/scripts/update.sh"
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable the timer
    systemctl enable gates-update.timer
    systemctl start gates-update.timer
    
    log_info "Systemd services configured"
}

setup_hostname() {
    log_info "Setting up mDNS hostname..."
    
    # Set hostname to 'gates'
    hostnamectl set-hostname gates
    
    # Update /etc/hosts
    if ! grep -q "gates" /etc/hosts; then
        echo "127.0.0.1 gates gates.local" >> /etc/hosts
    fi
    
    log_info "Hostname set to 'gates' (accessible via gates.local)"
}

start_application() {
    log_info "Starting Gates application..."
    
    cd "$INSTALL_DIR"
    
    # Build and start with production compose
    docker compose -f docker-compose.prod.yml up -d --build
    
    log_info "Waiting for services to start..."
    sleep 30
    
    # Check health
    if curl -sf http://localhost/api/health > /dev/null 2>&1; then
        log_info "Application is healthy!"
    else
        log_warn "Health check failed. Services may still be starting..."
        log_info "Check logs with: docker compose -f docker-compose.prod.yml logs"
    fi
}

print_next_steps() {
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Installation Complete!${NC}"
    echo "=========================================="
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Access the application:"
    echo "   - Local: http://gates.local or http://$(hostname -I | awk '{print $1}')"
    echo ""
    echo "2. Complete Authentik setup:"
    echo "   - Go to http://gates.local:9000/if/flow/initial-setup/"
    echo "   - Create admin account"
    echo "   - Create OAuth2 provider for 'gates'"
    echo ""
    echo "3. Update configuration:"
    echo "   - Edit $INSTALL_DIR/.env for environment settings"
    echo "   - Edit $INSTALL_DIR/config/gates.yaml for gate configuration"
    echo ""
    echo "4. For remote access:"
    echo "   - Set up Cloudflare Tunnel and add CLOUDFLARE_TUNNEL_TOKEN to .env"
    echo "   - Run: docker compose -f docker-compose.prod.yml --profile remote-access up -d"
    echo ""
    echo "Useful commands:"
    echo "   - View logs: docker compose -f docker-compose.prod.yml logs -f"
    echo "   - Restart: docker compose -f docker-compose.prod.yml restart"
    echo "   - Stop: docker compose -f docker-compose.prod.yml down"
    echo ""
}

main() {
    log_info "Starting Gates installation..."
    
    check_root
    check_architecture
    install_dependencies
    install_docker
    setup_gpio
    clone_repository
    setup_environment
    setup_hostname
    setup_systemd
    start_application
    print_next_steps
}

# Run main function
main "$@"
