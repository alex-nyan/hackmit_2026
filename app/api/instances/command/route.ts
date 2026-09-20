import {
  body,
  command,
  ownerFrom,
  parseCommand,
  respond,
} from "@/features/officer-instance/server";
import { InstanceError } from "@/features/officer-instance/model";
export async function POST(request: Request) {
  return respond(async () => {
    const data = await body(request);
    if (typeof data.id !== "string" || data.id.length > 64)
      throw new InstanceError("An instance ID is required.");
    return command(
      data.id,
      parseCommand(data),
      ownerFrom(request),
      data.sequence as number | undefined,
    );
  });
}
