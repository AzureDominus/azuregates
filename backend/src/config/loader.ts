import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { config } from './env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type { GatesConfig } from './schema.js';
import type { Prisma } from '@prisma/client';

const ajv = new (Ajv as unknown as typeof Ajv.default)({ allErrors: true, strict: false });
(addFormats as unknown as typeof addFormats.default)(ajv);

let configSchema: object | null = null;
let currentConfig: GatesConfig | null = null;

async function loadSchema(): Promise<object> {
  if (configSchema) return configSchema;
  
  const schemaPath = path.join(config.configDir, 'gates.schema.json');
  const schemaContent = await fs.readFile(schemaPath, 'utf-8');
  configSchema = JSON.parse(schemaContent);
  return configSchema!;
}

export async function loadConfig(): Promise<GatesConfig> {
  const configContent = await fs.readFile(config.configPath, 'utf-8');
  const parsed = yaml.load(configContent) as GatesConfig;
  
  // Validate against schema
  const schema = await loadSchema();
  const validate = ajv.compile(schema);
  const valid = validate(parsed);
  
  if (!valid) {
    const errors = validate.errors?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`).join(', ');
    throw new Error(`Config validation failed: ${errors}`);
  }
  
  // Sync to database
  await syncConfigToDatabase(parsed);
  
  currentConfig = parsed;
  return parsed;
}

export function getConfig(): GatesConfig | null {
  return currentConfig;
}

async function syncConfigToDatabase(gatesConfig: GatesConfig): Promise<void> {
  logger.info('Syncing configuration to database...');
  
  for (const location of gatesConfig.locations) {
    await prisma.location.upsert({
      where: { id: location.id },
      create: {
        id: location.id,
        name: location.name,
        enabled: location.enabled ?? true,
        metadata: (location.metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        name: location.name,
        enabled: location.enabled ?? true,
        metadata: (location.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    
    for (const area of location.areas ?? []) {
      await prisma.area.upsert({
        where: { id: area.id },
        create: {
          id: area.id,
          locationId: location.id,
          name: area.name,
          enabled: area.enabled ?? true,
          metadata: (area.metadata ?? {}) as Prisma.InputJsonValue,
        },
        update: {
          locationId: location.id,
          name: area.name,
          enabled: area.enabled ?? true,
          metadata: (area.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      
      for (const gate of area.gates ?? []) {
        await prisma.gate.upsert({
          where: { id: gate.id },
          create: {
            id: gate.id,
            areaId: area.id,
            name: gate.name,
            enabled: gate.enabled ?? true,
            driverType: gate.driver,
            driverConfig: (gate.config ?? {}) as unknown as Prisma.InputJsonValue,
            capabilities: gate.capabilities,
            metadata: (gate.metadata ?? {}) as unknown as Prisma.InputJsonValue,
          },
          update: {
            areaId: area.id,
            name: gate.name,
            enabled: gate.enabled ?? true,
            driverType: gate.driver,
            driverConfig: (gate.config ?? {}) as unknown as Prisma.InputJsonValue,
            capabilities: gate.capabilities,
            metadata: (gate.metadata ?? {}) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
  }
  
  logger.info('Configuration synced to database');
}

export async function saveConfig(newConfig: GatesConfig): Promise<void> {
  const schema = await loadSchema();
  const validate = ajv.compile(schema);
  const valid = validate(newConfig);
  
  if (!valid) {
    const errors = validate.errors?.map((e: { instancePath: string; message?: string }) => `${e.instancePath} ${e.message}`).join(', ');
    throw new Error(`Config validation failed: ${errors}`);
  }
  
  // Backup current config
  await backupConfig();
  
  // Write to temp file first (atomic write)
  const tempPath = `${config.configPath}.tmp`;
  const yamlContent = yaml.dump(newConfig, { indent: 2, lineWidth: 120 });
  await fs.writeFile(tempPath, yamlContent, 'utf-8');
  
  // Rename temp to actual (atomic on most filesystems)
  await fs.rename(tempPath, config.configPath);
  
  // Sync to database
  await syncConfigToDatabase(newConfig);
  
  currentConfig = newConfig;
  logger.info('Configuration saved and synced');
}

async function backupConfig(): Promise<void> {
  const historyDir = path.join(path.dirname(config.configPath), 'history');
  
  try {
    await fs.mkdir(historyDir, { recursive: true });
  } catch {
    // Directory may already exist
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(historyDir, `gates-${timestamp}.yaml`);
  
  try {
    await fs.copyFile(config.configPath, backupPath);
    logger.info({ backupPath }, 'Config backed up');
    
    // Keep only last 10 backups
    await pruneBackups(historyDir, 10);
  } catch (err) {
    logger.warn({ err }, 'Failed to backup config');
  }
}

async function pruneBackups(historyDir: string, keep: number): Promise<void> {
  const files = await fs.readdir(historyDir);
  const backups = files
    .filter((f) => f.startsWith('gates-') && f.endsWith('.yaml'))
    .sort()
    .reverse();
  
  for (const file of backups.slice(keep)) {
    await fs.unlink(path.join(historyDir, file));
    logger.debug({ file }, 'Pruned old backup');
  }
}

export async function getConfigHistory(): Promise<string[]> {
  const historyDir = path.join(path.dirname(config.configPath), 'history');
  
  try {
    const files = await fs.readdir(historyDir);
    return files
      .filter((f) => f.startsWith('gates-') && f.endsWith('.yaml'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function restoreConfig(filename: string): Promise<GatesConfig> {
  const historyDir = path.join(path.dirname(config.configPath), 'history');
  const backupPath = path.join(historyDir, filename);
  
  // Validate the filename to prevent path traversal
  if (filename.includes('..') || !filename.startsWith('gates-')) {
    throw new Error('Invalid backup filename');
  }
  
  const content = await fs.readFile(backupPath, 'utf-8');
  const parsed = yaml.load(content) as GatesConfig;
  
  await saveConfig(parsed);
  return parsed;
}
