import { NextResponse, type NextRequest } from "next/server";

import {
  COOKIE_NAME,
  digest,
  isOpenPath,
  matches,
  requiredPassphrase,
} from "@/features/access/passphrase";

/**
 * Holds the shared passphrase in front of every page and route.
 *
 * `middleware` is the deprecated name in this version of Next; this is the
 * same thing under its current one.
 */
export async function proxy(request: NextRequest) {
  const expected = requiredPassphrase(process.env);
  if (!expected) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();

  const presented = request.cookies.get(COOKIE_NAME)?.value ?? "";
  if (presented && matches(presented, await digest(expected))) return NextResponse.next();

  // An API caller gets an answer it can act on rather than a login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  const unlock = new URL("/unlock", request.url);
  unlock.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(unlock);
}

export const config = {
  // Everything except Next's own assets, which carry nothing worth gating.
  matcher: ["/((?!_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
