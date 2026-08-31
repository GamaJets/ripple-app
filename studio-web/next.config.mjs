/** @type {import('next').NextConfig} */
const nextConfig = {
  // The analytics, scoring and financial review live in ../src/lib and are
  // plain TypeScript — 180 of the 187 modules there import neither React nor
  // React Native. This lets the web app compile them straight from the phone
  // app's tree rather than keeping a second copy that drifts.
  experimental: { externalDir: true },
  reactStrictMode: true,
};
export default nextConfig;
