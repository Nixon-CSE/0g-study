'use client';

import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { defineChain } from 'viem';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

// 0G testnet — register so Privy embedded wallets can sign INFT transactions
// without prompting the user to add the chain manually.
const ogTestnet = defineChain({
  id: 16602,
  name: '0G Galileo Testnet',
  nativeCurrency: { name: 'OG', symbol: 'OG', decimals: 18 },
  rpcUrls: { default: { http: ['https://evmrpc-testnet.0g.ai'] } },
  blockExplorers: { default: { name: '0G Explorer', url: 'https://chainscan-galileo.0g.ai' } },
  testnet: true,
});

/**
 * Wraps the app in Privy's React provider.
 *
 * Must be a 'use client' component because PrivyProvider uses React context
 * and browser APIs internally. The root layout.tsx is a Server Component, so
 * we delegate the client boundary to this wrapper.
 *
 * appId is read from NEXT_PUBLIC_PRIVY_APP_ID. Set this in .env.local.
 *
 * SSR/build note: Privy validates the app ID immediately on render and throws
 * for missing/invalid IDs. When NEXT_PUBLIC_PRIVY_APP_ID is absent (e.g. in
 * a CI build without .env.local), we fall back to rendering children directly
 * so Next.js static-page generation can still succeed. At runtime the env var
 * must be set — Privy's usePrivy() hook will return ready=false until the
 * provider is properly mounted.
 */
export default function PrivyClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Privy requires exactly 25 characters in the app ID (validated internally).
  // Skip the provider during build/SSR when the env var is absent or clearly
  // invalid so static-generation prerender passes succeed.
  if (!appId || appId.length !== 25) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme: 'dark', accentColor: '#0d0d0f' },
        defaultChain: ogTestnet,
        supportedChains: [ogTestnet],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
