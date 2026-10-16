/** @type {import('next').NextConfig} */
const demo = process.env.NEXT_PUBLIC_DEMO === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = demo
  ? {
      // Static, browser-only POC for GitHub Pages.
      output: "export",
      basePath,
      trailingSlash: true,
      transpilePackages: ["@leksy/template-engine", "@leksy/bill-schema", "@leksy/mapper", "@leksy/survey"],
    }
  : {
      output: "standalone",
      transpilePackages: ["@leksy/template-engine", "@leksy/bill-schema", "@leksy/mapper", "@leksy/survey"],
      poweredByHeader: false,
    };
export default nextConfig;
