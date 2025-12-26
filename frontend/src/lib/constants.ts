/**
 * Application Constants
 * Centralized configuration for app name, version, and company info
 */

// App info - used throughout the app
export const APP_NAME = 'AzureGates';
export const APP_SHORT_NAME = 'Gates';
export const APP_DESCRIPTION = 'Secure Access Control System';
export const APP_VERSION = '1.0.14';

// Company info
export const COMPANY_NAME = 'AzureTech';
export const COPYRIGHT_YEAR = new Date().getFullYear();
export const COPYRIGHT_TEXT = `© ${COPYRIGHT_YEAR} ${COMPANY_NAME}`;

// PWA configuration
export const PWA_THEME_COLOR = '#00d2ff';
export const PWA_BACKGROUND_COLOR = '#050508';

// Cache versioning for PWA
export const CACHE_VERSION = `v${APP_VERSION}`;
export const CACHE_NAME = `${APP_SHORT_NAME.toLowerCase()}-cache-${CACHE_VERSION}`;
