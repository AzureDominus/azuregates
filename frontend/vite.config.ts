import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Vite plugin to auto-bump version numbers on build.
 * Increments the patch version in sw.js and constants.ts
 */
function autoBumpVersion(): import('vite').Plugin {
  return {
    name: 'auto-bump-version',
    buildStart() {
      // Only bump version on production builds
      if (process.env.NODE_ENV !== 'production') return;

      const constantsPath = path.resolve(__dirname, 'src/lib/constants.ts');
      const swPath = path.resolve(__dirname, 'public/sw.js');

      // Read current version from constants.ts
      let constantsContent = fs.readFileSync(constantsPath, 'utf-8');
      const versionMatch = constantsContent.match(/APP_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
      
      if (versionMatch) {
        const currentVersion = versionMatch[1];
        const parts = currentVersion.split('.');
        parts[2] = String(parseInt(parts[2], 10) + 1);
        const newVersion = parts.join('.');

        // Update constants.ts
        constantsContent = constantsContent.replace(
          /APP_VERSION\s*=\s*['"][\d.]+['"]/,
          `APP_VERSION = '${newVersion}'`
        );
        fs.writeFileSync(constantsPath, constantsContent);

        // Update sw.js
        let swContent = fs.readFileSync(swPath, 'utf-8');
        swContent = swContent.replace(
          /APP_VERSION\s*=\s*['"][\d.]+['"]/,
          `APP_VERSION = '${newVersion}'`
        );
        fs.writeFileSync(swPath, swContent);

        console.log(`\n📦 Auto-bumped version: ${currentVersion} → ${newVersion}\n`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), autoBumpVersion()],
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
