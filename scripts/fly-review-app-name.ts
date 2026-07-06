const prNumber = process.env.PR_NUMBER;
const repositoryName = process.env.REPOSITORY_NAME;

if (!prNumber || !/^\d+$/.test(prNumber)) {
  throw new Error("PR_NUMBER must be a numeric pull request number");
}

if (!repositoryName) {
  throw new Error("REPOSITORY_NAME is required");
}

const prefix = process.env.FLY_REVIEW_APP_PREFIX || `${repositoryName}-pr`;
const normalized = `${prefix}-${prNumber}`
  .toLowerCase()
  .replaceAll("_", "-")
  .replaceAll(/[^a-z0-9-]/g, "")
  .slice(0, 63)
  .replaceAll(/-+$/g, "");

if (!normalized) {
  throw new Error("Could not compute review app name");
}

process.stdout.write(normalized);

export {};
