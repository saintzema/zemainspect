import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Route protection.
 *
 * With the database session strategy the JWT is not the source of truth, so
 * this only checks for the presence of a session cookie and lets the page's
 * own server component do the authoritative lookup. Role gating for /admin is
 * enforced again in app/admin/layout.tsx — middleware alone is not a security
 * boundary here.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sessionToken =
    request.cookies.get("next-auth.session-token") ??
    request.cookies.get("__Secure-next-auth.session-token");

  const signedIn =
    !!sessionToken ||
    !!(await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null));

  if (!signedIn) {
    const signIn = new URL("/signin", request.url);
    signIn.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/trends/:path*",
    "/reports/:path*",
    "/api-keys/:path*",
    "/billing/:path*",
    "/team/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
  ],
};
