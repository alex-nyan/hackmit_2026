import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseSessionInfo } from "../../../../shared/contracts";

export const SESSION_COOKIE = "paw_live_session";
const SESSION_SECONDS = 8 * 60 * 60;
const NO_STORE = { "Cache-Control": "no-store" };

function secret() {
  const value = process.env.LIVE_SESSION_SECRET ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("live_session_not_configured");
  return Buffer.from(value, "hex");
}

export function sealSession(token: string, now = Date.now()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify({ token, expires: now + SESSION_SECONDS * 1000 })),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function openSession(value: string | undefined, now = Date.now()): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", secret(), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    return typeof parsed.token === "string" && Number.isFinite(parsed.expires) && parsed.expires > now
      ? parsed.token : null;
  } catch { return null; }
}

export function sessionCookie(value: string, request: Request, clear = false) {
  const secure = new URL(request.url).protocol === "https:";
  return `${SESSION_COOKIE}=${value}; Path=/api/live; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function sessionToken(request: Request) {
  const pair = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim())
    .find(v => v.startsWith(`${SESSION_COOKIE}=`));
  return openSession(pair?.slice(SESSION_COOKIE.length + 1));
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return origin === url.origin && (url.protocol === "https:" || local);
}

export function failure(code: string, status: number) {
  return Response.json({ error: code }, { status, headers: NO_STORE });
}

export async function limitedBody(request: Request, limit = 16_384): Promise<string> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("request_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const deadline = Date.now() + 10_000;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("request_read_timeout")), Math.max(1, deadline - Date.now())); }),
      ]).finally(() => clearTimeout(timer));
      const { value, done } = next;
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error("request_too_large"); }
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export function backendUrl(path: string) {
  const url = new URL(process.env.TRIAGE_URL ?? "http://127.0.0.1:8090");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("invalid_triage_url");
  }
  return new URL(path, url);
}

export async function login(request: Request) {
  if (!sameOrigin(request)) return failure("origin_not_allowed", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("json_required", 415);
  try {
    secret();
    const body = JSON.parse(await limitedBody(request, 4096));
    if (typeof body.token !== "string" || !/^[\x21-\x7e]{32,256}$/.test(body.token)) return failure("invalid_token", 400);
    const response = await fetch(backendUrl("/v2/session"), {
      headers: { Authorization: `Bearer ${body.token}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return failure("sign_in_rejected", response.status === 401 || response.status === 403 ? response.status : 502);
    const session = parseSessionInfo(await response.json());
    if (session.role === "source") return failure("operator_session_required", 403);
    return Response.json(session, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie(sealSession(body.token), request) } });
  } catch (error) {
    return failure(error instanceof Error && error.message === "live_session_not_configured" ? "live_session_not_configured" : "sign_in_unavailable", 503);
  }
}

export function logout(request: Request) {
  if (!sameOrigin(request)) return failure("origin_not_allowed", 403);
  return Response.json({ signed_out: true }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie("", request, true) } });
}

export async function proxy(request: Request, path: string[]) {
  const token = sessionToken(request);
  if (!token) return failure("sign_in_required", 401);
  const id = /^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,127}$/;
  const session = path.length === 1 && path[0] === "session";
  const incident = path.length === 3 && path[0] === "incidents" && id.test(path[1]);
  const evidence = path.length === 2 && path[0] === "evidence" && id.test(path[1]);
  const read = request.method === "GET" && (session || evidence || (incident && ["state", "events"].includes(path[2])));
  const write = request.method === "POST" && incident && path[2] === "commands";
  if (!read && !write) return failure("route_not_allowed", 404);
  if (write && !sameOrigin(request)) return failure("origin_not_allowed", 403);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  let body: string | undefined;
  try {
    if (write) {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("json_required", 415);
      body = await limitedBody(request);
      headers.set("Content-Type", "application/json");
      const key = request.headers.get("idempotency-key");
      if (key) headers.set("Idempotency-Key", key);
    }
    const cursor = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
    if (cursor && /^\d{1,16}$/.test(cursor)) headers.set("Last-Event-ID", cursor);
    const streaming = incident && path[2] === "events";
    const response = await fetch(backendUrl(`/v2/${path.map(encodeURIComponent).join("/")}`), {
      method: request.method, headers, body, cache: "no-store", redirect: "error",
      signal: streaming ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { ...NO_STORE, "Content-Type": response.headers.get("content-type") ?? "application/json", "X-Accel-Buffering": "no" },
    });
  } catch { return failure("incident_service_unavailable", 503); }
}
