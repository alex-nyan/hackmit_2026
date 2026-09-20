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
  // Only ever back into this app, never to a URL an attacker supplied.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!matches(await digest(offered), await digest(expected))) {
    const retry = new URL("/unlock", request.url);
    retry.searchParams.set("next", destination);
    retry.searchParams.set("wrong", "1");
    return Response.redirect(retry, 303);
  }

  const response = new Response(null, {
    status: 303,
    headers: { Location: new URL(destination, request.url).toString() },
  });
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${await digest(expected)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax; Secure`,
  );
  return response;
}
