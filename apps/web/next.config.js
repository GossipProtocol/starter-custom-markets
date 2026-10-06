/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { missingSuspenseWithCSRBailout: false },
  webpack: (config) => {
    // Privy's optional Farcaster mini-app integration is not used here.
    config.resolve.alias['@farcaster/mini-app-solana'] = false
    return config
  },
  // Privy's iframe and RPCs. Tighten `connect-src` to your RPC host before mainnet.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'self' https://auth.privy.io",
              "child-src https://auth.privy.io",
              "frame-src https://auth.privy.io https://challenges.cloudflare.com",
              "connect-src 'self' https://auth.privy.io https://*.rpc.privy.systems wss://*.rpc.privy.systems https://*.solana.com wss://*.solana.com https://*.helius-rpc.com wss://*.helius-rpc.com",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
