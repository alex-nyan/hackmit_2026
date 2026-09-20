import {
  COOKIE_MAX_AGE_SECONDS,
  COOKIE_NAME,
  digest,
  matches,
  requiredPassphrase,
} from "@/features/access/passphrase";

/** Exchanges the shared passphrase for the cookie the proxy looks for. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const expected = requiredPassphrase(process.env);
  if (!expected) return Response.redirect(new URL("/", request.url), 303);

  const form = await request.formData();
  const offered = String(form.get("passphrase") ?? "");
  const next = String(form.get("next") ?? "/");
  // Check the parsed origin too: URL normalizes backslashes, so checking only
  // a leading slash would allow an off-site destination such as /\\host.
  const requestOrigin = new URL(request.url).origin;
  let destination = new URL("/", requestOrigin);
  if (next.startsWith("/") && !next.startsWith("//")) {
    try {
      const proposed = new URL(next, requestOrigin);
      if (proposed.origin === requestOrigin) destination = proposed;
    } catch {
      // Malformed destinations return to the application root.
    }
  }

  if (!matches(await digest(offered), await digest(expected))) {
    const retry = new URL("/unlock", request.url);
    retry.searchParams.set("next", destination.pathname + destination.search + destination.hash);
    retry.searchParams.set("wrong", "1");
    return Response.redirect(retry, 303);
  }

  const response = new Response(null, {
    status: 303,
    headers: { Location: destination.toString() },
  });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${await digest(expected)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax; Secure`,
  );
  return response;
}
