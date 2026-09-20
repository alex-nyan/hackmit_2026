import { body, mediaToken, ownerFrom, respond } from "@/features/officer-instance/server";
import { InstanceError } from "@/features/officer-instance/model";
export async function POST(request: Request) {
  return respond(async () => {
    const data = await body(request);
    if (
      typeof data.id !== "string" ||
      !["viewer", "publisher", "hospital"].includes(String(data.role))
    )
      throw new InstanceError("Invalid media role.");
    return mediaToken(
      data.id,
      data.role as "viewer" | "publisher" | "hospital",
      ownerFrom(request),
    );
  });
}
