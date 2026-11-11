const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

function isLoopbackAddress(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function assertLoopbackHost(host, label = "destination") {
  if (!host) return;
  const hostname = String(host)
    .replace(/^\[|\]$/g, "")
    .split(":")[0];
  if (!hostname || hostname.startsWith("/")) return;
  if (net.isIP(hostname)) {
    if (!isLoopbackAddress(hostname)) {
      throw new Error(`Blocked non-loopback ${label} ${hostname}`);
    }
    return;
  }
  const records = dns.lookupSync(hostname, { all: true });
  if (
    records.length === 0 ||
    records.some((record) => !isLoopbackAddress(record.address))
  ) {
    throw new Error(`Blocked non-loopback ${label} ${hostname}`);
  }
}

function hostFromOptions(options) {
  if (typeof options === "string") return new URL(options).hostname;
  if (options instanceof URL) return options.hostname;
  const host = options.hostname || options.host || "";
  return String(host).replace(/:\d+$/, "");
}

function assertRequest(options) {
  assertLoopbackHost(hostFromOptions(options));
  const path = typeof options === "object" && options ? options.path : "";
  if (typeof path === "string" && /^https?:\/\//i.test(path)) {
    assertLoopbackHost(new URL(path).hostname, "proxy target");
  }
}

function wrapRequest(module) {
  const original = module.request;
  module.request = function wrapped(options, callback) {
    assertRequest(options);
    return original.call(this, options, callback);
  };
  const originalGet = module.get;
  module.get = function wrappedGet(options, callback) {
    assertRequest(options);
    return originalGet.call(this, options, callback);
  };
}

function installOutboundGuard() {
  if (globalThis.__resumeLoadTestGuard) return;
  globalThis.__resumeLoadTestGuard = true;
  wrapRequest(http);
  wrapRequest(https);
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const options = args[0];
    if (typeof options === "object" && options) {
      assertLoopbackHost(options.host || options.hostname);
    } else if (typeof args[1] === "string") {
      assertLoopbackHost(args[1]);
    }
    return originalConnect.apply(this, args);
  };
  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function guardedFetch(input, init) {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      assertLoopbackHost(new URL(raw).hostname);
      return originalFetch(input, init);
    };
  }
}

module.exports = { installOutboundGuard, assertLoopbackHost };
