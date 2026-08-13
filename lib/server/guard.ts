import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ConfigError } from '@/lib/server/upstream';

/**
 * SSRF guard for the three routes that fetch a user-supplied URL.
 *
 * The whole app is built around "paste any endpoint", so the proxy is an
 * arbitrary-URL fetcher by design. Deployed publicly that is also a way to
 * reach anything the server can reach and nobody else can — cloud metadata
 * services, an internal admin panel, a database on the same VPC — with the
 * response handed straight back to the caller. Blocking private destinations
 * costs a public deployment nothing, since no reseller lives on 10.0.0.0/8.
 *
 * Local development is the exception that has to keep working: the LiteLLM and
 * Local-proxy presets point at localhost on purpose. So private targets are
 * allowed outside production, or when ALLOW_PRIVATE_ENDPOINTS=1 is set
 * explicitly by whoever is hosting.
 */

function v4Parts(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved space. */
export function isPrivateAddress(address: string): boolean {
  // Accept the bracketed form a URL hostname carries for IPv6.
  const ip = address.replace(/^\[|\]$/g, '');
  const family = isIP(ip);
  if (family === 4) {
    const p = v4Parts(ip);
    if (!p) return true; // unparseable: refuse rather than guess
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0 || b === 88)) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a === 203 && b === 0) return true;
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }
  if (family === 6) {
    const ip6 = ip.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms.
    const mapped = /^(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(ip6);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (ip6 === '::' || ip6 === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(ip6)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(ip6)) return true; // fe80::/10 link-local
    if (/^ff[0-9a-f]{2}:/.test(ip6)) return true; // ff00::/8 multicast
    return false;
  }
  return false; // not an IP literal — the caller resolves it
}

/** Names that never belong to a public API host. */
const BLOCKED_HOST =
  /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$|(^|\.)metadata\.(google\.internal|goog)$|^host\.docker\.internal$/i;

function privateTargetsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_ENDPOINTS === '1' || process.env.NODE_ENV !== 'production';
}

/**
 * Throws `ConfigError` when `url` points somewhere only this server can reach.
 * Resolves hostnames, so a public name pointing at 127.0.0.1 is caught too.
 */
export async function assertPublicTarget(url: string): Promise<void> {
  if (privateTargetsAllowed()) return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ConfigError(`"${url}" is not a valid URL.`);
  }
  const bare = host.replace(/^\[|\]$/g, '');

  if (BLOCKED_HOST.test(bare)) {
    throw new ConfigError(`This server will not fetch "${host}" — only public endpoints are allowed.`);
  }

  if (isIP(bare)) {
    if (isPrivateAddress(bare)) {
      throw new ConfigError(`"${host}" is a private or reserved address. Only public endpoints are allowed.`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new ConfigError(`Could not resolve "${host}". Check the endpoint hostname.`);
  }
  // Every answer must be public: one private record is enough to rebind onto.
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ConfigError(`"${host}" resolves to a private address. Only public endpoints are allowed.`);
  }
}

/**
 * Guard for the routes that touch the machine the server runs on: writing
 * ~/.claude/settings.json, writing OpenCode's config, and shelling out to
 * `claude doctor`. Those only make sense when the app IS the user's machine.
 *
 * Publicly deployed, they would let any visitor rewrite the host's CLI config
 * and run a process on it, so they are off unless the deployment opts in with
 * ENABLE_LOCAL_WRITES=1 — the same switch a user running `next start` locally
 * can set. Development is treated as local by default.
 *
 * Returns null when allowed, or a `Response` to return unchanged.
 */
export function localWritesBlocked(): Response | null {
  if (process.env.ENABLE_LOCAL_WRITES === '1' || process.env.NODE_ENV !== 'production') return null;
  return Response.json(
    {
      error:
        'This build cannot write CLI config or run local commands. Those features need the app running on your own machine (npm run dev), where it can reach your home directory.',
    },
    { status: 403 },
  );
}
