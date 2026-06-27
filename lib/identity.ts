export function normalizeIdentity(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export type IdentityCandidate = {
  id: number;
  canonical: string;
  aliases: string[];
};

export type IdentityResolution =
  | { status: "matched"; candidate: IdentityCandidate }
  | { status: "unknown"; suggestions: IdentityCandidate[] }
  | { status: "ambiguous"; candidates: IdentityCandidate[] };

export function resolveIdentity(input: string, candidates: IdentityCandidate[]): IdentityResolution {
  const normalized = normalizeIdentity(input);
  const matches = candidates.filter((candidate) =>
    [candidate.canonical, ...candidate.aliases].some((value) => normalizeIdentity(value) === normalized)
  );
  if (matches.length === 1) return { status: "matched", candidate: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };

  const suggestions = candidates
    .filter((candidate) =>
      [candidate.canonical, ...candidate.aliases].some((value) => {
        const key = normalizeIdentity(value);
        return key.includes(normalized) || normalized.includes(key);
      })
    )
    .slice(0, 5);
  return { status: "unknown", suggestions };
}
