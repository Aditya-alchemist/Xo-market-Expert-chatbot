import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        zlib: false,
        buffer: false,
        stream: false,
        http: false,
        https: false,
        crypto: false,
        net: false,
        tls: false,
        fs: false,
      };

      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^zlib-sync$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^bufferutil$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^utf-8-validate$/,
        })
      );
    }

    return config;
  },
  serverExternalPackages: ['discord.js'],
};

export default nextConfig;
