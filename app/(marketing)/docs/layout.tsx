import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration docs",
  description:
    "REST API, signed webhooks and export paths for connecting ZemaInspect to an existing MES or ERP.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
