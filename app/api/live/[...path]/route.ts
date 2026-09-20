import { proxy } from "@/features/live-incident/serverGateway";

export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function POST(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
