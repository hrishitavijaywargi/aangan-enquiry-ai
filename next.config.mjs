/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native SQLite driver and mailer must stay server-side and unbundled.
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
};
export default nextConfig;
