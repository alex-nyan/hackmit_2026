import { login, logout, proxy } from "@/features/live-incident/serverGateway";

export const runtime = "nodejs";
export const POST = login;
export const DELETE = logout;
export async function GET(request: Request) { return proxy(request, ["session"]); }
