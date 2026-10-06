import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { PrivyProvider } from '@privy-io/expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from './src/lib/config';

/**
 * The Expo SDK keys embedded wallet options under `embedded`, not
 * `embeddedWallets` (that is the web SDK's key). The product this came from
 * shipped the web key here, which the Expo SDK ignores, so no Solana wallet
 * was created on login and every bet failed with "no wallet".
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        clientId={PRIVY_CLIENT_ID}
        config={{
          embedded: {
            solana: { createOnLogin: 'all-users' },
            ethereum: { createOnLogin: 'off' },
          },
        }}
      >
        <RootNavigator />
        <StatusBar style="dark" />
      </PrivyProvider>
    </SafeAreaProvider>
  );
}
