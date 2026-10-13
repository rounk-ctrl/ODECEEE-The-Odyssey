const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Add it to the deployment environment.`);
  }
  return value;
};

const jwtSecret =
  process.env.JWT_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
if (!jwtSecret) {
  throw new Error(
    "JWT_SECRET or SESSION_SECRET is required. Add it to the deployment environment.",
  );
}
if (jwtSecret.length < 32) {
  throw new Error("The JWT signing secret must contain at least 32 characters.");
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  adminUsername: required("ADMIN_USERNAME"),
  adminPassword: required("ADMIN_PASSWORD"),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
};
