/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // TypeScript 6 ships the compiler API Next 16's Turbopack build needs.
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
