import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Read version info from constants.ts (single source of truth)
 */
function getVersionInfo(): { version: string; name: string; shortName: string } {
  const constantsPath = path.resolve(__dirname, 'src/lib/constants.ts');
  const content = fs.readFileSync(constantsPath, 'utf-8');
  
  const versionMatch = content.match(/APP_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  const nameMatch = content.match(/APP_NAME\s*=\s*['"]([^'"]+)['"]/);
  const shortNameMatch = content.match(/APP_SHORT_NAME\s*=\s*['"]([^'"]+)['"]/);
  
  return {
    version: versionMatch?.[1] ?? '0.0.0',
    name: nameMatch?.[1] ?? 'App',
    shortName: shortNameMatch?.[1] ?? 'App',
  };
}

/**
 * Vite plugin to sync version to service worker on build.
 * Generates version.js that sw.js imports via importScripts.
 * Also auto-bumps version on production builds.
 */
function syncVersionPlugin(): import('vite').Plugin {
  return {
    name: 'sync-version',
    buildStart() {
      const constantsPath = path.resolve(__dirname, 'src/lib/constants.ts');
      const versionJsPath = path.resolve(__dirname, 'public/version.js');
      
      let info = getVersionInfo();
      
      // Auto-bump version when VERSION_BUMP flag is set
      // Usage: VERSION_BUMP=1 BUMP_TYPE=patch bun run build (default: patch)
      if (process.env.VERSION_BUMP === '1' || process.env.VERSION_BUMP === 'true') {
        const oldVersion = info.version;
        const bumpType = process.env.BUMP_TYPE || 'patch';
        
        if (!['major', 'minor', 'patch'].includes(bumpType)) {
          console.error(`Invalid BUMP_TYPE: ${bumpType}. Must be major, minor, or patch.`);
          process.exit(1);
        }
        
        const parts = info.version.split('.').map(Number);
        let newVersion: string;
        
        if (bumpType === 'major') {
          newVersion = `${parts[0] + 1}.0.0`;
        } else if (bumpType === 'minor') {
          newVersion = `${parts[0]}.${parts[1] + 1}.0`;
        } else {
          newVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
        }
        
        // Update constants.ts
        let constantsContent = fs.readFileSync(constantsPath, 'utf-8');
        constantsContent = constantsContent.replace(
          /APP_VERSION\s*=\s*['"][\d.]+['"]/,
          `APP_VERSION = '${newVersion}'`
        );
        fs.writeFileSync(constantsPath, constantsContent);
        
        info.version = newVersion;
        console.log(`\n📦 Auto-bumped version (${bumpType}): ${oldVersion} → ${newVersion}\n`);
      } else {
        console.log(`\n📄 Building with version ${info.version} (no bump)\n`);
      }
      
      // Generate version.js for service worker
      const versionJs = `// Auto-generated - DO NOT EDIT
// Source of truth: src/lib/constants.ts
const APP_NAME = '${info.name}';
const APP_SHORT_NAME = '${info.shortName}';
const APP_VERSION = '${info.version}';
const CACHE_NAME = \`\${APP_SHORT_NAME.toLowerCase()}-cache-v\${APP_VERSION}\`;
`;
      fs.writeFileSync(versionJsPath, versionJs);
      console.log(`📄 Generated version.js (v${info.version})`);
    },
  };
}

export default defineConfig({
  plugins: [react(), syncVersionPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Monaco editor into separate chunk (only loaded on Settings page)
          'monaco': ['@monaco-editor/react', 'monaco-yaml'],
          // Split vendor libraries
          'vendor': ['react', 'react-dom'],
          'router': ['@tanstack/react-router'],
          'query': ['@tanstack/react-query'],
          'framer': ['framer-motion'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
    },
  },
});
