/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@leksy/template-engine", "@leksy/bill-schema", "@leksy/mapper"],
  poweredByHeader: false,
};
export default nextConfig;
