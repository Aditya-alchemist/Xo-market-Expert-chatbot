/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'zlib-sync': false,
        'bufferutil': false,
        'utf-8-validate': false,
      };
    }
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['discord.js'],
  },
};

module.exports = nextConfig;
