/**
 * NextAuth throws a hard `new URL('')` crash — at MODULE LOAD time, not
 * inside any function we could wrap in try/catch — the moment it is imported
 * on a route that Next.js tries to statically pre-render, if NEXTAUTH_URL
 * resolves to an empty string. That takes down every non-force-dynamic page
 * in the app (marketing, sign-in, onboarding) with one missing env var.
 *
 * The correct fix is always to set NEXTAUTH_URL explicitly — Google's OAuth
 * redirect URI has to be registered against a real, known domain regardless.
 * But Vercel gives every deployment a working URL for free (VERCEL_URL for
 * previews, VERCEL_PROJECT_PRODUCTION_URL for the stable production alias),
 * so there's no reason a forgotten env var should ever hard-crash a build
 * when a correct fallback is one line away.
 */
function inferredAppUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return undefined;
}

const appUrl = inferredAppUrl();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Only fills in what's missing — an explicitly-set NEXTAUTH_URL always
    // wins, since process.env.NEXTAUTH_URL is read first above.
    ...(appUrl ? { NEXTAUTH_URL: appUrl, NEXT_PUBLIC_APP_URL: appUrl } : {}),
  },

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
      /*
       * NO cross-origin isolation headers here, deliberately.
       *
       * COOP: same-origin + COEP: credentialless were added on the theory
       * that exposing SharedArrayBuffer would let onnxruntime-web load its
       * smaller 13.9 MB threaded WASM binary instead of the 25.7 MB asyncify
       * one. That theory was then disproved directly: the published
       * `ort.webgpu` bundle picks its binary with a constant baked in at the
       * library's own build time — `false ? jsep : false ? jspi : true ?
       * asyncify : plain` — so no header this app sends can change it. The
       * headers were verified to turn crossOriginIsolated on, and to change
       * nothing about which file loads.
       *
       * They were also the only recent change that could plausibly explain a
       * Chrome-specific "no available backend found. ERR: [wasm] [object
       * Event]" — a worker-load failure — while Safari kept working: Chrome
       * enforces `credentialless` and Safari largely does not, which is
       * precisely that split. Zero measured benefit against a live suspect in
       * a browser half the target market uses is not a trade worth keeping.
       */
    ];
  },
};

export default nextConfig;
