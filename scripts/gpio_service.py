#!/usr/bin/env python3
"""
GPIO Service for AzureGates
Runs on the Raspberry Pi host (not in Docker) and provides GPIO control via HTTP API.

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
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import RPi.GPIO as GPIO

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
