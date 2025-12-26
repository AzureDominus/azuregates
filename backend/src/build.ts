#!/usr/bin/env node
/**
 * Backend Build Script
 * Handles version bumping and compilation.
 * 
 * Usage:
 *   bun run build          - Build without version bump
 *   bun run build:bump     - Build with version bump (VERSION_BUMP=1)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versionPath = path.join(__dirname, 'version.ts');

function bumpVersion() {
  const content = fs.readFileSync(versionPath, 'utf-8');
  const match = content.match(/BACKEND_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  
  if (!match) {
    console.error('Could not find version in version.ts');
    process.exit(1);
  }
  
  const currentVersion = match[1];
  const parts = currentVersion.split('.');
  parts[2] = String(parseInt(parts[2], 10) + 1);
  const newVersion = parts.join('.');
  
  const newContent = content.replace(
    /BACKEND_VERSION\s*=\s*['"][\d.]+['"]/,
    `BACKEND_VERSION = '${newVersion}'`
  );
  
  fs.writeFileSync(versionPath, newContent);
  console.log(`Backend version: ${currentVersion} -> ${newVersion}`);
  return newVersion;
}

function getVersion() {
  const content = fs.readFileSync(versionPath, 'utf-8');
  const match = content.match(/BACKEND_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  return match ? match[1] : '0.0.0';
}

// Check if we should bump version
const shouldBump = process.env.VERSION_BUMP === '1' || process.env.VERSION_BUMP === 'true';

if (shouldBump) {
  bumpVersion();
} else {
  console.log(`Backend version: ${getVersion()} (no bump)`);
}

// Run TypeScript compilation
console.log('Compiling TypeScript...');
execSync('tsc', { stdio: 'inherit', cwd: __dirname });
console.log('Build complete.');
