type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const raw = process.env.FLY_IMAGE_JSON;
if (!raw) {
  throw new Error("FLY_IMAGE_JSON is required");
}

const image = JSON.parse(raw) as JsonValue;
const strings: string[] = [];
visit(image);

const ref = strings.find((value) => value.startsWith("registry.fly.io/"));
if (!ref) {
  throw new Error(`Could not find Fly image ref in: ${JSON.stringify(image)}`);
}

process.stdout.write(ref);

function visit(value: JsonValue): void {
  if (typeof value === "string") {
    strings.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }

  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(visit);
  }
}

export {};
