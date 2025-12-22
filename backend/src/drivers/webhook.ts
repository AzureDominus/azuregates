import type { Gate } from '@prisma/client';
import { z } from 'zod';
import { BaseDriver, type DriverResult } from './base.js';
import type { GateAction, WebhookDriverConfig } from '../config/schema.js';
import { logger } from '../lib/logger.js';

const webhookConfigSchema = z.object({
  endpoints: z
    .object({
      open: z.string().url().optional(),
      close: z.string().url().optional(),
      stop: z.string().url().optional(),
      toggle: z.string().url().optional(),
      state: z.string().url().optional(),
    })
    .optional(),
  endpoint: z.string().url().optional(),
  actionParam: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().min(100).max(30000).default(5000),
});

export class WebhookDriver extends BaseDriver {
  readonly name = 'webhook';
  readonly supportedActions: GateAction[] = ['open', 'close', 'stop', 'toggle', 'state'];

  async execute(gate: Gate, action: GateAction): Promise<DriverResult> {
    const config = gate.driverConfig as WebhookDriverConfig;
    const url = this.getEndpointUrl(config, action);

    if (!url) {
      return {
        success: false,
        message: `No endpoint configured for action: ${action}`,
      };
    }

    const method = config.method || 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 5000);

    try {
      logger.info({ gateId: gate.id, action, url, method }, 'Executing webhook');

      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify({ action, gateId: gate.id, gateName: gate.name }) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error({ gateId: gate.id, action, status: response.status, errorText }, 'Webhook failed');
        return {
          success: false,
          message: `Webhook returned ${response.status}: ${errorText}`,
        };
      }

      let data: Record<string, unknown> = {};
      try {
        data = await response.json();
      } catch {
        // Response may not be JSON
      }

      logger.info({ gateId: gate.id, action, status: response.status }, 'Webhook executed successfully');

      return {
        success: true,
        message: `Action ${action} executed successfully`,
        data,
      };
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === 'AbortError') {
        logger.error({ gateId: gate.id, action }, 'Webhook timed out');
        return {
          success: false,
          message: 'Webhook request timed out',
        };
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ gateId: gate.id, action, err }, 'Webhook execution failed');
      return {
        success: false,
        message: `Webhook execution failed: ${errorMessage}`,
      };
    }
  }

  private getEndpointUrl(config: WebhookDriverConfig, action: GateAction): string | null {
    // Check for action-specific endpoint
    if (config.endpoints && config.endpoints[action]) {
      return config.endpoints[action]!;
    }

    // Check for unified endpoint with action parameter
    if (config.endpoint) {
      const url = new URL(config.endpoint);
      if (config.actionParam) {
        url.searchParams.set(config.actionParam, action);
      }
      return url.toString();
    }

    return null;
  }

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const result = webhookConfigSchema.safeParse(config);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
    }

    // Must have either endpoints or endpoint
    const parsed = result.data;
    if (!parsed.endpoints && !parsed.endpoint) {
      return {
        valid: false,
        errors: ['Either "endpoints" or "endpoint" must be configured'],
      };
    }

    return { valid: true };
  }
}

export const webhookDriver = new WebhookDriver();
