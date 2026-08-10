import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';

const DEFAULT_MAX_REDIRECTS = 3;

export interface SafeFetchTextOptions {
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
  maxRedirects?: number;
  allowedContentTypes?: string[];
}

export interface SafeFetchTextResult {
  status: number;
  ok: boolean;
  url: string;
  contentType: string | null;
  text: string;
}

export type PublicAddressLookup = (hostname: string) => Promise<Array<{
  address: string;
  family: number;
}>>;

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function parsePublicHttpUrl(raw: string, label = 'URL'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} cannot contain a username or password`);
  }
  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`${label} must use a public hostname`);
  }
  if (ipaddr.isValid(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error(`${label} must not target a private, local, or reserved address`);
  }
  return url;
}

export function isPublicIpAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6') {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

async function defaultLookup(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function resolvePublicAddresses(
  url: URL,
  lookup: PublicAddressLookup = defaultLookup
): Promise<Array<{ address: string; family: number }>> {
  const hostname = normalizedHostname(url.hostname);
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await lookup(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error('URL resolves to a private, local, or reserved network address');
  }
  return addresses;
}

function pinnedDispatcher(addresses: Array<{ address: string; family: number }>): Agent {
  return new Agent({
    connect: {
      lookup: ((_hostname: string, options: any, callback: any) => {
        const family = typeof options === 'number' ? options : options?.family;
        const candidates = family === 4 || family === 6
          ? addresses.filter((address) => address.family === family)
          : addresses;
        const selected = candidates.length > 0 ? candidates : addresses;
        if (options?.all) callback(null, selected);
        else callback(null, selected[0].address, selected[0].family);
      }) as any,
    },
  });
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`response exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchTextOptions,
  lookup: PublicAddressLookup = defaultLookup
): Promise<SafeFetchTextResult> {
  let url = parsePublicHttpUrl(rawUrl);
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const addresses = await resolvePublicAddresses(url, lookup);
    const dispatcher = pinnedDispatcher(addresses);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': options.userAgent, Accept: 'text/html, application/xml, text/xml;q=0.9, */*;q=0.1' },
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher,
      } as RequestInit & { dispatcher: Agent });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error(`redirect ${response.status} did not include a location`);
        if (redirectCount === maxRedirects) throw new Error('too many redirects');
        url = parsePublicHttpUrl(new URL(location, url).toString(), 'redirect URL');
        continue;
      }

      const contentType = response.headers.get('content-type');
      if (
        contentType
        && options.allowedContentTypes
        && !options.allowedContentTypes.some((allowed) => contentType.toLowerCase().startsWith(allowed))
      ) {
        await response.body?.cancel();
        throw new Error(`response has unsupported content type ${contentType}`);
      }
      return {
        status: response.status,
        ok: response.ok,
        url: url.toString(),
        contentType,
        text: await readBodyWithLimit(response as unknown as Response, options.maxBytes),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error('too many redirects');
}
