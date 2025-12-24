#!/usr/bin/env python3
"""
GPIO Service for AzureGates
Runs on the Raspberry Pi host (not in Docker) and provides GPIO control via HTTP API.

Usage:
    ./gpio_service.py [--port PORT]

API:
    POST /pulse
    Body: {"pin": 17, "duration_ms": 500, "active_low": true}
    
    GET /status
    Returns current pin states

The backend container calls this service to control GPIO pins.
"""

import argparse
import json
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import RPi.GPIO as GPIO

# Track active pins and their states
pin_states = {}
pin_locks = {}

def get_pin_lock(pin):
    """Get or create a lock for a specific pin."""
    if pin not in pin_locks:
        pin_locks[pin] = threading.Lock()
    return pin_locks[pin]

def pulse_pin(pin, duration_ms, active_low=True):
    """
    Pulse a GPIO pin for a specified duration.
    
    Args:
        pin: BCM GPIO pin number
        duration_ms: Duration to hold the active state in milliseconds
        active_low: If True, pulse LOW to activate (relay closes). If False, pulse HIGH.
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
        
        # Wait for duration
        time.sleep(duration_ms / 1000.0)
        
        # Return to inactive
        GPIO.output(pin, inactive_state)
        pin_states[pin] = "inactive"
        
        return {"success": True, "pin": pin, "duration_ms": duration_ms}
    
    except Exception as e:
        return {"success": False, "error": str(e)}
    
    finally:
        lock.release()

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
        if self.path == "/status":
            self.send_json({
                "success": True,
                "pins": pin_states,
                "locked": [p for p, l in pin_locks.items() if l.locked()]
            })
        elif self.path == "/health":
            self.send_json({"status": "ok"})
        else:
            self.send_json({"error": "Not found"}, 404)
    
    def do_POST(self):
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
            
            # Run pulse in a thread so we can return immediately for long pulses
            # But for short pulses, wait for completion
            if duration_ms <= 1000:
                result = pulse_pin(pin, duration_ms, active_low)
                self.send_json(result, 200 if result["success"] else 409)
            else:
                # For long pulses, start in background and return immediately
                def run_pulse():
                    pulse_pin(pin, duration_ms, active_low)
                
                thread = threading.Thread(target=run_pulse)
                thread.start()
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
            # Force all pins to inactive (HIGH for active-low relays)
            pin = data.get("pin")
            if pin:
                result = set_pin(pin, True)  # Set HIGH (inactive for active-low)
                self.send_json(result)
            else:
                # Stop all active pins
                for p in list(pin_states.keys()):
                    set_pin(p, True)
                self.send_json({"success": True, "stopped": list(pin_states.keys())})
        
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
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        GPIO.cleanup()
        print("GPIO cleanup done")

if __name__ == "__main__":
    main()
