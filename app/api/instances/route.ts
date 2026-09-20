import { body, create, respond, snapshot } from "@/features/officer-instance/server";
import { InstanceError } from "@/features/officer-instance/model";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return respond(() => snapshot(new URL(request.url).searchParams.get("role") === "hospital"));
}
export async function POST(request: Request) {
  return respond(async () => {
    const data = await body(request);
    if (
      typeof data.displayName !== "string" ||
      (data.replaceId !== undefined && typeof data.replaceId !== "string")
    )
      throw new InstanceError("Enter an officer name.");
    return create(data.displayName, data.replaceId as string | undefined);
  });
}
