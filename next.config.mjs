/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    /*
     * These packages must stay outside the webpack bundle:
     *  - onnxruntime-node ships prebuilt .node binaries per platform, which
     *    webpack cannot parse and must not try to inline
     *  - sharp is a native module for the same reason
     *  - @react-pdf/renderer resolves fonts and streams at runtime
     */
    serverComponentsExternalPackages: [
      "onnxruntime-node",
      // onnxruntime-web only ever runs in the browser, but its package
      // exports resolve to a Node ESM build during the server compile that
      // the bundler cannot parse. Externalising it keeps it out of that pass.
      "onnxruntime-web",
      "sharp",
      "@react-pdf/renderer",
    ],
  },

  images: {
    // Inspection frames come back as Vercel Blob URLs.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },

  async headers() {
    return [
      {
        // The ONNX weights and the ORT wasm runtime are immutable per deploy;
        // caching them hard is what keeps edge-inference startup fast on a
        // slow factory link.
        source: "/:path(models|ort)/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
