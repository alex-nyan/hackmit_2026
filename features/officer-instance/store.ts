import { Redis } from "@upstash/redis";
import { InstanceError, type StoredInstance } from "./model";

export function instanceNamespace(env: Record<string, string | undefined> = process.env) {
  const project = env.INSTANCE_NAMESPACE?.trim();
  if (!project) throw new InstanceError("Configure INSTANCE_NAMESPACE for this deployment.", 503);
  const scope = env.VERCEL_ENV ?? "development";
  const branch = scope === "preview" ? env.VERCEL_GIT_COMMIT_REF || env.VERCEL_URL : "shared";
  if (!branch) throw new InstanceError("Preview namespace is unavailable.", 503);
  return `officer-instance:${project}:${scope}:${branch}`;
}
function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token)
    throw new InstanceError("Configure Upstash Redis to create a shared instance.", 503);
  return new Redis({ url, token, automaticDeserialization: false });
}
export interface AtomicStore {
  read(): Promise<string | null>;
  compareAndSet(previous: string | null, next: string, ttlSeconds: number): Promise<boolean>;
}
export function instanceStore(): AtomicStore {
  const client = redis();
  const key = instanceNamespace();
  return {
    read: () => client.get<string>(key),
    compareAndSet: async (previous, next, ttl) =>
      (await client.eval<(string | number)[], number>(
        `local current = redis.call('GET', KEYS[1])
       if (current or '') ~= ARGV[1] then return 0 end
       redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
       return 1`,
        [key],
        [previous ?? "", next, ttl],
      )) === 1,
  };
}
/** Optimistic retries are cross-process safe; the callback must have no side effects. */
export async function transact(
  store: AtomicStore,
  change: (current: StoredInstance | null) => StoredInstance,
  now: number,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = await store.read();
    const next = change(raw ? (JSON.parse(raw) as StoredInstance) : null);
    const ttl = Math.max(1, Math.ceil((next.instance.expiresAt - now) / 1000));
    if (await store.compareAndSet(raw, JSON.stringify(next), ttl)) return next;
  }
  throw new InstanceError("The instance changed. Please try again.", 409);
}
