export const nameResource = (project: string, stage: string) => (base: string) =>
  `${project}-${stage}-${base}`;

export function getAllEnvVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out[k] = v; // include all defined vars
  }
  return out;
}

export function getRequiredEnvVar(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function getEnvVars(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const val = process.env[name];
    if (val !== undefined) out[name] = val;
  }
  return out;
}
