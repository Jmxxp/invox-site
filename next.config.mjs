/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  basePath: "/invox-site",
  assetPrefix: "/invox-site",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
