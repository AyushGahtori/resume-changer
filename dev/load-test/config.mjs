export const DEFAULTS = {
  users: 1000,
  concurrency: 100,
  browserPercent: 5,
  seed: 42,
  apiRps: 20,
  startsPerSecond: 1,
  requestTimeoutMs: 15_000,
  sessionTimeoutMs: 900_000,
  runTimeoutMs: 7_200_000,
  baseURL: "http://127.0.0.1:3020",
};

export function parseInteger(name, value, minimum, maximum) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const command = argv[0] ?? "run";
  if (!["run", "smoke", "estimate", "cleanup"].includes(command)) {
    throw new Error(`Unknown load-test command: ${command}`);
  }
  const options = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unknown argument ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  const unknown = Object.keys(options).filter(
    (key) =>
      ![
        "command",
        "users",
        "concurrency",
        "browser-percent",
        "seed",
        "resume",
        "run-id",
        "api-rps",
        "base-url",
      ].includes(key),
  );
  if (unknown.length) throw new Error(`Unknown argument --${unknown[0]}`);
  return options;
}

export function resolveRunConfig(options, overrides = {}) {
  const config = {
    ...DEFAULTS,
    ...overrides,
    users: options.users
      ? parseInteger("users", options.users, 1, 1000)
      : (overrides.users ?? DEFAULTS.users),
    concurrency: options.concurrency
      ? parseInteger("concurrency", options.concurrency, 1, 120)
      : (overrides.concurrency ?? DEFAULTS.concurrency),
    browserPercent: options["browser-percent"]
      ? parseInteger("browser-percent", options["browser-percent"], 0, 100)
      : (overrides.browserPercent ?? DEFAULTS.browserPercent),
    seed: options.seed
      ? parseInteger(
          "seed",
          options.seed,
          Number.MIN_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        )
      : (overrides.seed ?? DEFAULTS.seed),
    apiRps: options["api-rps"]
      ? parseInteger("api-rps", options["api-rps"], 1, 100)
      : (overrides.apiRps ?? DEFAULTS.apiRps),
    baseURL: options["base-url"] ?? overrides.baseURL ?? DEFAULTS.baseURL,
  };
  if (options.command !== "estimate" && config.concurrency > config.users) {
    throw new Error("concurrency cannot be greater than users.");
  }
  if (!Number.isFinite(config.seed)) throw new Error("seed must be finite.");
  return config;
}
