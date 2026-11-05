
/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_BUILD_IN_PROCESS=1 renders pages in worker threads instead of child processes. Opt-in escape
  // hatch for machines where Next's child-process workers hang (seen locally); Vercel builds don't need it.
  ...(process.env.NEXT_BUILD_IN_PROCESS === '1' ? { experimental: { workerThreads: true, cpus: 1 } } : {}),
  webpack(config) {
    // Privy SDK optionally imports @farcaster/mini-app-solana for Farcaster Mini
    // App support. We don't use that feature, so stub it out to avoid a missing-
    // module build error.
    config.resolve.alias['@farcaster/mini-app-solana'] = false;
    return config;
  },
};

export default nextConfig;
