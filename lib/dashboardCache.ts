// The browser cache is a convenience only. The user id is an untrusted partition
// key; server requests must still authenticate Telegram initData independently.
const PREFIX = "telexpense:dashboard:v1:";
const MAX_AGE_MS = 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type Snapshot<T> = { version: 1; generation: number; savedAt: number; value: T };

export function telegramCacheUserId(initData: string): number | null {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get("user") || "null");
    return Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : null;
  } catch {
    return null;
  }
}

export function createDashboardCache(storage: StorageLike, userId: number, now = () => Date.now()) {
  const prefix = `${PREFIX}${userId}:`;
  const generationKey = `${prefix}generation`;
  const generation = (): number | null => {
    try {
      const value = storage.getItem(generationKey);
      if (value === null) return 0;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  return {
    generation,
    read<T>(month: string): { value: T; savedAt: number } | null {
      try {
        const current = generation();
        const raw = storage.getItem(`${prefix}${month}`);
        if (current === null || !raw) return null;
        const snapshot: Snapshot<T> = JSON.parse(raw);
        const age = now() - snapshot.savedAt;
        if (snapshot.version !== 1 || snapshot.generation !== current || !Number.isFinite(age) || age < 0 || age >= MAX_AGE_MS ||
            new Date(snapshot.savedAt).toISOString().slice(0, 10) !== new Date(now()).toISOString().slice(0, 10) ||
            !snapshot.value || typeof snapshot.value !== "object") return null;
        return { value: snapshot.value, savedAt: snapshot.savedAt };
      } catch {
        return null;
      }
    },
    write<T>(month: string, value: T, expectedGeneration: number | null, savedAt = now()): number | null {
      try {
        if (expectedGeneration === null || generation() !== expectedGeneration) return null;
        storage.setItem(`${prefix}${month}`, JSON.stringify({ version: 1, generation: expectedGeneration, savedAt, value }));
        return savedAt;
      } catch {
        return null;
      }
    },
    invalidate() {
      try {
        const current = generation();
        if (current !== null) storage.setItem(generationKey, String(current + 1));
      } catch {
        // Storage is optional; network loading remains available.
      }
    }
  };
}
