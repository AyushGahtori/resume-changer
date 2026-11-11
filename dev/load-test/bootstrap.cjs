const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { installOutboundGuard } = require("./outbound-guard.cjs");

installOutboundGuard();

const nextPackage = require.resolve("next/package.json");
const requireFromNext = createRequire(nextPackage);
const envPath = requireFromNext.resolve("@next/env");
const envModule = requireFromNext(envPath);
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-load-env-"));
const loaded = envModule.loadEnvConfig(emptyDir, false);
function loadIsolatedEnv(_dir, _dev, _log, force) {
  if (force) {
    throw new Error(
      "Next tried to reload environment files. Refusing to run the load test with repository env files.",
    );
  }
  return loaded;
}
// @next/env exports loadEnvConfig through a non-configurable getter, so the
// cached module is replaced before Next's CLI loads it.
require.cache[envPath].exports = new Proxy(envModule, {
  get(target, property, receiver) {
    if (property === "loadEnvConfig") return loadIsolatedEnv;
    return Reflect.get(target, property, receiver);
  },
});
