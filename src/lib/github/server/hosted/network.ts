import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable } from "node:stream";
import type { GithubFetch } from "../client-core";

export async function resolveGithubAddresses(
  hostname: string,
  signal: AbortSignal,
) {
  if (hostname !== "api.github.com" || signal.aborted)
    throw new Error("Invalid GitHub destination.");
  return (await lookup(hostname, { all: true })).map((item) => item.address);
}
/** Connect to a DNS address already validated by the shared transport policy. */
export const fetchPinnedGithub: GithubFetch = (url, init, destination) =>
  new Promise((resolve, reject) => {
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.github.com" ||
      destination.hostname !== "api.github.com" ||
      !destination.addresses.length ||
      url.port ||
      url.username ||
      url.password
    ) {
      reject(new Error("Invalid GitHub destination."));
      return;
    }
    const address = destination.addresses[0];
    const headers: Record<string, string> = { "Accept-Encoding": "identity" };
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    headers["Accept-Encoding"] = "identity";
    const outgoing = request(
      url,
      {
        method: "GET",
        headers,
        servername: "api.github.com",
        rejectUnauthorized: true,
        family: address.includes(":") ? 6 : 4,
        signal: init.signal ?? undefined,
        lookup: (_host, _options, callback) =>
          callback(null, address, address.includes(":") ? 6 : 4),
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            responseHeaders.set(
              name,
              Array.isArray(value) ? value.join(", ") : value,
            );
        const status = incoming.statusCode ?? 502;
        if (status === 204 || status === 304) incoming.resume();
        resolve(
          new Response(
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(incoming) as ReadableStream),
            { status, headers: responseHeaders },
          ),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
