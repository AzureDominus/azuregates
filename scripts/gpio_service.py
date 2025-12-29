#!/usr/bin/env python3
"""
GPIO Service for AzureGates
Runs on the Raspberry Pi host (not in Docker) and provides GPIO control via HTTP API.

SECURITY:
    - Only accepts requests from localhost (127.0.0.1, ::1) or Docker bridge (172.17.0.0/16)
    - Requires X-GPIO-Secret header matching GPIO_SERVICE_SECRET environment variable

Usage:
    ./gpio_service.py [--port PORT] [--host HOST]

API:
    POST /pulse
    Body: {"pin": 17, "duration_ms": 500, "active_low": true}
    
    POST /stop
    Body: {"pin": 17} or {} to stop all
    
    GET /status
    Returns current pin states and active pulses

The backend container calls this service to control GPIO pins.
"""

import argparse
import json
import os
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Load .env file from project root if it exists
def load_dotenv():
    """Load environment variables from .env file."""
    env_paths = [
        Path('/opt/gates/.env'),  # Production location on Pi
        Path(__file__).parent.parent / '.env',  # Development: relative to script
    ]
    for env_path in env_paths:
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, _, value = line.partition('=')
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key and key not in os.environ:  # Don't override existing env vars
                            os.environ[key] = value
            break

load_dotenv()

import RPi.GPIO as GPIO

# Security: Read secret from environment variable
GPIO_SERVICE_SECRET = os.environ.get('GPIO_SERVICE_SECRET', '')

# Allowed IP prefixes for security (localhost and Docker bridge network)
ALLOWED_IP_PREFIXES = ('127.', '::1', '172.17.', '172.18.', '172.19.', '172.20.')

# Track active pins and their states
pin_states = {}
pin_locks = {}

# Track active pulse operations (for stop functionality)
active_pulses = {}  # pin -> {"stop_event": Event, "thread": Thread, "start_time": float}

def get_pin_lock(pin):
    """Get or create a lock for a specific pin."""
    if pin not in pin_locks:
        pin_locks[pin] = threading.Lock()
    return pin_locks[pin]

def pulse_pin(pin, duration_ms, active_low=True, stop_event=None):
    """
    Pulse a GPIO pin for a specified duration.
    Supports early termination via stop_event.
    
    Args:
        pin: BCM GPIO pin number
        duration_ms: Duration to hold the active state in milliseconds
        active_low: If True, pulse LOW to activate (relay closes). If False, pulse HIGH.
        stop_event: Optional threading.Event to signal early stop
    """
    lock = get_pin_lock(pin)
    
    if not lock.acquire(blocking=False):
        return {"success": False, "error": f"Pin {pin} is busy"}
    
    try:
        # Setup pin as output if not already
        GPIO.setup(pin, GPIO.OUT)
        
        # Determine active/inactive states
        active_state = GPIO.LOW if active_low else GPIO.HIGH
        inactive_state = GPIO.HIGH if active_low else GPIO.LOW
        
        # Ensure pin starts inactive
        GPIO.output(pin, inactive_state)
        pin_states[pin] = "inactive"
        
        # Pulse to active
        GPIO.output(pin, active_state)
        pin_states[pin] = "active"
        
        # Wait for duration (interruptible)
        if stop_event:
            # Wait in small increments to check for stop signal
            elapsed = 0
            interval = 50  # Check every 50ms
            while elapsed < duration_ms:
                if stop_event.is_set():
                    # Early stop requested
                    GPIO.output(pin, inactive_state)
                    pin_states[pin] = "stopped"
                    return {"success": True, "pin": pin, "stopped": True, "elapsed_ms": elapsed}
                time.sleep(interval / 1000.0)
                elapsed += interval
        else:
            time.sleep(duration_ms / 1000.0)
        
        # Return to inactive
        GPIO.output(pin, inactive_state)
        pin_states[pin] = "inactive"
        
        return {"success": True, "pin": pin, "duration_ms": duration_ms}
    
    except Exception as e:
        # Ensure pin is inactive on error
        try:
            inactive_state = GPIO.HIGH if active_low else GPIO.LOW
            GPIO.output(pin, inactive_state)
            pin_states[pin] = "error"
        except:
            pass
        return {"success": False, "error": str(e)}
    
    finally:
        lock.release()
        # Clean up active pulse tracking
        if pin in active_pulses:
            del active_pulses[pin]

def set_pin(pin, high):
    """Set a GPIO pin to a specific state."""
    lock = get_pin_lock(pin)
    
    with lock:
        GPIO.setup(pin, GPIO.OUT)
        GPIO.output(pin, GPIO.HIGH if high else GPIO.LOW)
        pin_states[pin] = "high" if high else "low"
        return {"success": True, "pin": pin, "state": pin_states[pin]}

class GPIOHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Custom logging
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {args[0]}")
    
    def check_security(self):
        """
        Validate request is from allowed source with correct secret.
        Returns True if request is allowed, False otherwise.
        """
        # Check source IP
        client_ip = self.client_address[0]
        if not any(client_ip.startswith(prefix) for prefix in ALLOWED_IP_PREFIXES):
            print(f"[SECURITY] Rejected request from unauthorized IP: {client_ip}")
            self.send_json({"error": "Unauthorized: invalid source"}, 403)
            return False
        
        # Check secret header (if secret is configured)
        if GPIO_SERVICE_SECRET:
            provided_secret = self.headers.get('X-GPIO-Secret', '')
            if provided_secret != GPIO_SERVICE_SECRET:
                print(f"[SECURITY] Rejected request with invalid secret from {client_ip}")
                self.send_json({"error": "Unauthorized: invalid secret"}, 403)
                return False
        
        return True
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
    
    def do_GET(self):
        # Health check doesn't require auth (for Docker health checks)
        if self.path == "/health":
            self.send_json({"status": "ok"})
            return
        
        # All other endpoints require security validation
        if not self.check_security():
            return
        
        if self.path == "/status":
            # Build active pulses info
            pulses_info = {}
            for pin, info in active_pulses.items():
                elapsed = int((time.time() - info["start_time"]) * 1000)
                remaining = max(0, info["duration_ms"] - elapsed)
                pulses_info[pin] = {
                    "elapsed_ms": elapsed,
                    "remaining_ms": remaining,
                    "duration_ms": info["duration_ms"]
                }
            
            self.send_json({
                "success": True,
                "pins": pin_states,
                "active_pulses": pulses_info,
                "locked": [p for p, l in pin_locks.items() if l.locked()]
            })
        elif self.path.startswith("/read"):
            # Read GPIO pin states - GET /read?pins=17,18,22
            # For OUTPUT pins, returns tracked state. For INPUT pins, reads physical state.
            try:
                # Parse query parameters
                query = {}
                if "?" in self.path:
                    query_string = self.path.split("?", 1)[1]
                    for param in query_string.split("&"):
                        if "=" in param:
                            key, value = param.split("=", 1)
                            query[key] = value
                
                pins_param = query.get("pins", "")
                if not pins_param:
                    self.send_json({"success": False, "error": "Missing 'pins' parameter"}, 400)
                    return
                
                # Parse pin numbers
                pin_numbers = [int(p.strip()) for p in pins_param.split(",") if p.strip()]
                if not pin_numbers:
                    self.send_json({"success": False, "error": "No valid pins specified"}, 400)
                    return
                
                # Read pin states
                pin_readings = {}
                for pin in pin_numbers:
                    try:
                        # Check if this pin is being tracked as an OUTPUT (from set_pin calls)
                        if pin in pin_states:
                            # Return tracked state - don't reconfigure as INPUT
                            tracked_state = pin_states[pin]
                            is_high = tracked_state in ("high", "inactive")
                            pin_readings[str(pin)] = {
                                "state": 1 if is_high else 0,
                                "high": is_high,
                                "low": not is_high,
                                "tracked": True
                            }
                        else:
                            # Pin not tracked - setup as input and read physical state
                            GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
                            state = GPIO.input(pin)
                            pin_readings[str(pin)] = {
                                "state": state,
                                "high": state == GPIO.HIGH,
                                "low": state == GPIO.LOW,
                                "tracked": False
                            }
                    except Exception as e:
                        pin_readings[str(pin)] = {"error": str(e)}
                
                self.send_json({
                    "success": True,
                    "pins": pin_readings
                })
            except ValueError as e:
                self.send_json({"success": False, "error": f"Invalid pin number: {e}"}, 400)
            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, 500)
        else:
            self.send_json({"error": "Not found"}, 404)
    
    def do_POST(self):
        # All POST endpoints require security validation
        if not self.check_security():
            return
        
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode()
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        
        if self.path == "/pulse":
            pin = data.get("pin")
            duration_ms = data.get("duration_ms", 500)
            active_low = data.get("active_low", True)
            
            if pin is None:
                self.send_json({"error": "pin is required"}, 400)
                return
            
            # Check if this pin already has an active pulse
            if pin in active_pulses:
                self.send_json({"success": False, "error": f"Pin {pin} already has active pulse"}, 409)
                return
            
            # Create stop event for this pulse
            stop_event = threading.Event()
            
            # Always run in background thread with stop event for interruptibility
            def run_pulse():
                pulse_pin(pin, duration_ms, active_low, stop_event)
            
            thread = threading.Thread(target=run_pulse)
            active_pulses[pin] = {
                "stop_event": stop_event,
                "thread": thread,
                "start_time": time.time(),
                "duration_ms": duration_ms
            }
            thread.start()
            
            # For short pulses, wait for completion
            if duration_ms <= 1000:
                thread.join(timeout=(duration_ms / 1000.0) + 0.5)
                if pin in active_pulses:
                    del active_pulses[pin]
                self.send_json({"success": True, "pin": pin, "duration_ms": duration_ms})
            else:
                # For long pulses, return immediately
                self.send_json({"success": True, "pin": pin, "duration_ms": duration_ms, "async": True})
        
        elif self.path == "/set":
            pin = data.get("pin")
            high = data.get("high", True)
            
            if pin is None:
                self.send_json({"error": "pin is required"}, 400)
                return
            
            result = set_pin(pin, high)
            self.send_json(result)
        
        elif self.path == "/stop":
            # Stop active pulses and/or force pins to inactive
            pin = data.get("pin")
            stopped_pins = []
            
            if pin:
                # Stop specific pin
                if pin in active_pulses:
                    # Signal the pulse to stop
                    active_pulses[pin]["stop_event"].set()
                    # Wait briefly for thread to finish
                    active_pulses[pin]["thread"].join(timeout=0.2)
                    stopped_pins.append(pin)
                # Also force the pin HIGH (inactive for active-low relays)
                result = set_pin(pin, True)
                self.send_json({"success": True, "pin": pin, "stopped": pin in stopped_pins, "state": "inactive"})
            else:
                # Stop all active pulses
                for p in list(active_pulses.keys()):
                    active_pulses[p]["stop_event"].set()
                    active_pulses[p]["thread"].join(timeout=0.2)
                    stopped_pins.append(p)
                # Force all known pins to inactive
                for p in list(pin_states.keys()):
                    set_pin(p, True)
                self.send_json({"success": True, "stopped": stopped_pins, "reset_pins": list(pin_states.keys())})
        
        else:
            self.send_json({"error": "Not found"}, 404)

def main():
    parser = argparse.ArgumentParser(description="GPIO Service for AzureGates")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: localhost only)")
    args = parser.parse_args()
    
    # Initialize GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    
    print(f"GPIO Service starting on {args.host}:{args.port}")
    print("Endpoints:")
    print("  POST /pulse  - Pulse a pin (body: {pin, duration_ms, active_low})")
    print("  POST /set    - Set a pin state (body: {pin, high})")
    print("  POST /stop   - Stop/reset pins (body: {pin} or {} for all)")
    print("  GET  /status - Get pin states")
    print("  GET  /health - Health check")
    print()
    
    server = HTTPServer((args.host, args.port), GPIOHandler)
    
    # Notify systemd that we're ready (if running under systemd)
    try:
        import sdnotify
        notify = sdnotify.SystemdNotifier()
        notify.notify("READY=1")
        notify.notify(f"STATUS=Listening on {args.host}:{args.port}")
        print("Notified systemd: READY")
        
        # Set up watchdog timer (if configured in systemd)
        def watchdog_ping():
            while True:
                time.sleep(30)
                notify.notify("WATCHDOG=1")
        
        watchdog_thread = threading.Thread(target=watchdog_ping, daemon=True)
        watchdog_thread.start()
    except ImportError:
        print("sdnotify not installed, running without systemd integration")
    except Exception as e:
        print(f"Could not notify systemd: {e}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        GPIO.cleanup()
        print("GPIO cleanup done")

if __name__ == "__main__":
    main()
