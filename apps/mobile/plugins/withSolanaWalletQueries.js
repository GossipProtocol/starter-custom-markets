/**
 * Expo config plugin: adds an Android <queries> entry for the `solana-wallet:`
 * URI scheme so Mobile Wallet Adapter (MWA) can discover installed wallet apps
 * on Android 11+ under the new package-visibility rules.
 *
 * Without this, transact() returns "no wallet found" even when Phantom/Solflare/
 * Backpack are installed, because Android filters them out of the app's visible
 * package list.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const SOLANA_WALLET_SCHEME = 'solana-wallet';

module.exports = function withSolanaWalletQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    if (!Array.isArray(manifest.queries)) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];
    if (!Array.isArray(queries.intent)) {
      queries.intent = [];
    }

    const alreadyPresent = queries.intent.some((intent) =>
      Array.isArray(intent.data) &&
      intent.data.some(
        (d) => d && d.$ && d.$['android:scheme'] === SOLANA_WALLET_SCHEME
      )
    );

    if (!alreadyPresent) {
      queries.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': SOLANA_WALLET_SCHEME } }],
      });
    }

    return cfg;
  });
};
