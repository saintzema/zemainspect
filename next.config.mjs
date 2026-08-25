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
    /*
     * onnxruntime-node ships prebuilt binaries for five platforms (~283 MB
     * total): darwin/arm64, win32/x64, win32/arm64, linux/x64 and linux/arm64.
     * A serverless deploy only ever runs linux/x64 (~44 MB), and Vercel caps an
     * unzipped function at 250 MB — so shipping all five does not merely waste
     * space, it exceeds the limit and fails the deploy. Trace only what runs.
     */
    outputFileTracingExcludes: {
      "**/*": [
        "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
        "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
        "node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**",
      ],
    },

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
