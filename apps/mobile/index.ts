// Polyfills first: Privy and web3.js expect TextEncoder, crypto.getRandomValues and Buffer.
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
