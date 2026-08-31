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

  /*
   * NextAuth v4's email callback ignores `pages.error` and always redirects a
   * failed verification to its own /api/auth/error screen — verified against a
   * real build, the custom page is simply not used on this path. That screen
   * is English-only, unstyled, and dead-ends the operator away from the code
   * input they were just using. Bounce it back to our sign-in page, which
   * renders the failure in the user's chosen language beside the field.
   */
  if (pathname === "/api/auth/error") {
    const signIn = new URL("/signin", request.url);
    const reason = request.nextUrl.searchParams.get("error");
    if (reason) signIn.searchParams.set("error", reason);
    return NextResponse.redirect(signIn);
  }

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
    // Intercepted above and rewritten to /signin.
    "/api/auth/error",
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
