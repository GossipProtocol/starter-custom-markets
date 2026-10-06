#!/usr/bin/env node
/**
 * Patches expo to export config-plugins when the expo package doesn't include it.
 * expo-secure-store and other plugins require("expo/config-plugins").
 */
const fs = require('fs');
const path = require('path');

const expoDir = path.join(__dirname, '..', 'node_modules', 'expo');
const configPluginsPath = path.join(expoDir, 'config-plugins.js');

if (!fs.existsSync(expoDir)) {
  console.warn('patch-expo-config-plugins: expo not found, skipping');
  process.exit(0);
}

if (fs.existsSync(configPluginsPath)) {
  process.exit(0);
}

const content = "module.exports = require('@expo/config-plugins');\n";
fs.writeFileSync(configPluginsPath, content);
console.log('patch-expo-config-plugins: created expo/config-plugins.js');
