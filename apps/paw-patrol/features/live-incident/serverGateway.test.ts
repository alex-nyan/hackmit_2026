// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendUrl, login, openSession, proxy, sealSession, SESSION_COOKIE } from "./serverGateway";

const token = "o".repeat(40);
function configure() { vi.stubEnv("LIVE_SESSION_SECRET", "a".repeat(64)); vi.stubEnv("TRIAGE_URL", "http://127.0.0.1:8090"); }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("live operator gateway", () => {
  it("encrypts and authenticates expiring sessions", () => {
    configure();
    const session = sealSession(token, 1_000);
    expect(session).not.toContain(token);
    expect(openSession(session, 2_000)).toBe(token);
    expect(openSession(session, 30_000_000)).toBeNull();
    expect(openSession(`x${session.slice(1)}`, 2_000)).toBeNull();
  });
  it("rejects cross-origin sign in before contacting the service", async () => {
    configure(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await login(new Request("http://localhost:5176/api/live/session", { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ token }) }));
    expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it("verifies an operator credential and puts it only in an encrypted HttpOnly cookie", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ principal_id: "dispatch-1", role: "dispatch", incident_ids: ["case-1"], source_ids: [] })));
    const response = await login(new Request("http://localhost:5176/api/live/session", { method: "POST", headers: { origin: "http://localhost:5176", "content-type": "application/json" }, body: JSON.stringify({ token }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    expect(await response.text()).not.toContain(token);
  });
  it("rejects source credentials for browser operator sessions", async () => {
    configure(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ principal_id: "phone", role: "source", incident_ids: ["case-1"], source_ids: ["phone"] })));
    const response = await login(new Request("http://localhost:5176/api/live/session", { method: "POST", headers: { origin: "http://localhost:5176", "content-type": "application/json" }, body: JSON.stringify({ token }) }));
    expect(response.status).toBe(403); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("limits proxy routes and rejects cross-origin commands", async () => {
    configure(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const headers = { cookie: `${SESSION_COOKIE}=${sealSession(token)}`, origin: "https://attacker.invalid" };
    expect((await proxy(new Request("http://localhost/api/live/ingest/media", { headers }), ["ingest", "media"])).status).toBe(404);
    expect((await proxy(new Request("http://localhost/api/live/incidents/x/commands", { method: "POST", headers }), ["incidents", "x", "commands"])).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("only allows encrypted remote backend URLs and never URL credentials", () => {
    configure(); expect(backendUrl("/v2/session").hostname).toBe("127.0.0.1");
    vi.stubEnv("TRIAGE_URL", "http://192.168.1.2:8090"); expect(() => backendUrl("/v2/session")).toThrow();
    vi.stubEnv("TRIAGE_URL", "https://user:secret@example.com"); expect(() => backendUrl("/v2/session")).toThrow();
  });
});
