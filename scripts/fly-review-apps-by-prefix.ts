type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const raw = process.env.APPS_JSON;
const prefix = process.env.REVIEW_PREFIX;

if (!raw) {
  throw new Error("APPS_JSON is required");
}

if (!prefix) {
  throw new Error("REVIEW_PREFIX is required");
}

const apps = JSON.parse(raw) as JsonValue;
if (!Array.isArray(apps)) {
  throw new Error(`Expected Fly apps list to be an array: ${JSON.stringify(apps)}`);
}

const names = apps
  .map(appName)
  .filter((name): name is string => typeof name === "string" && name.startsWith(`${prefix}-`));

process.stdout.write(names.join("\n"));

function appName(value: JsonValue): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  for (const key of ["Name", "name", "ID", "id"]) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return null;
}

export {};
