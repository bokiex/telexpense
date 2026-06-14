export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function optionalEnv(name: string, fallback = "") {
  return process.env[name] || fallback;
}

