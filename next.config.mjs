/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build run alongside `npm run dev` (NEXT_DIST_DIR=.next-build npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server-only libraries: keep them out of the bundle and load them from node_modules at runtime.
  serverExternalPackages: ["nodemailer", "postgres"],
};
export default nextConfig;
