import express from 'express';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Gate state simulation (in-memory)
const gateStates = new Map();

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('  Body:', JSON.stringify(req.body));
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-gate-server' });
});

// Generic gate action endpoint
// Simulates a gate controller that accepts commands
app.post('/gate/:gateId/:action', (req, res) => {
  const { gateId, action } = req.params;
  const validActions = ['open', 'close', 'stop', 'toggle'];

  if (!validActions.includes(action)) {
    return res.status(400).json({
      success: false,
      error: `Invalid action: ${action}. Valid actions: ${validActions.join(', ')}`,
    });
  }

  // Simulate processing time (100-500ms)
  const delay = Math.floor(Math.random() * 400) + 100;

  setTimeout(() => {
    // Simulate occasional failures (5% chance)
    if (Math.random() < 0.05) {
      console.log(`  ❌ Simulated failure for gate ${gateId} action ${action}`);
      return res.status(500).json({
        success: false,
        error: 'Simulated gate controller error',
      });
    }

    // Update simulated state
    let newState = 'unknown';
    if (action === 'open') newState = 'opening';
    else if (action === 'close') newState = 'closing';
    else if (action === 'stop') newState = 'stopped';
    else if (action === 'toggle') {
      const currentState = gateStates.get(gateId) || 'closed';
      newState = currentState === 'closed' ? 'opening' : 'closing';
    }

    gateStates.set(gateId, newState);

    console.log(`  ✓ Gate ${gateId} action ${action} executed (new state: ${newState})`);

    res.json({
      success: true,
      gateId,
      action,
      state: newState,
      timestamp: new Date().toISOString(),
      simulatedDelay: delay,
    });
  }, delay);
});

// Get gate state
app.get('/gate/:gateId/state', (req, res) => {
  const { gateId } = req.params;
  const state = gateStates.get(gateId) || 'unknown';

  res.json({
    gateId,
    state,
    timestamp: new Date().toISOString(),
  });
});

// Unified action endpoint (alternative pattern)
app.post('/gates/command', (req, res) => {
  const { gateId, action, gateName } = req.body;

  if (!gateId || !action) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: gateId, action',
    });
  }

  const validActions = ['open', 'close', 'stop', 'toggle'];
  if (!validActions.includes(action)) {
    return res.status(400).json({
      success: false,
      error: `Invalid action: ${action}`,
    });
  }

  // Simulate processing
  const delay = Math.floor(Math.random() * 300) + 100;

  setTimeout(() => {
    console.log(`  ✓ Command received: ${action} on gate ${gateName || gateId}`);

    res.json({
      success: true,
      gateId,
      gateName,
      action,
      message: `Action ${action} executed successfully`,
      timestamp: new Date().toISOString(),
    });
  }, delay);
});

// List all known gates and their states
app.get('/gates', (req, res) => {
  const gates = Array.from(gateStates.entries()).map(([id, state]) => ({
    id,
    state,
  }));

  res.json({ gates });
});

// Reset all gates
app.post('/reset', (req, res) => {
  gateStates.clear();
  console.log('  🔄 All gate states reset');
  res.json({ success: true, message: 'All gates reset' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Mock Gate Webhook Server                          ║
║         Port: ${PORT}                                         ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    POST /gate/:gateId/:action  - Execute gate action      ║
║    GET  /gate/:gateId/state    - Get gate state           ║
║    POST /gates/command         - Unified command endpoint ║
║    GET  /gates                 - List all gates           ║
║    POST /reset                 - Reset all gate states    ║
║    GET  /health                - Health check             ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
