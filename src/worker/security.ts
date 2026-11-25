const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'ip6-localhost',
  'ip6-loopback'
]);

/**
 * Checks whether an IPv4 address belongs to loopback, private, link-local, or reserved ranges.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

/**
 * Checks whether a hostname is a private/local IPv6 or obfuscated numeric IP literal.
 */
function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (PRIVATE_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return true;
  }

  // Block integer / hex / octal IP notation (e.g. 2130706433 or 0x7f000001)
  if (/^(0x[0-9a-f]+|\d+|0[0-7]+)$/i.test(host)) {
    return true;
  }

  // Dotted IPv4 literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isPrivateIPv4(host);
  }

  // IPv6 literal checks (loopback ::1, unspecified ::, ULA fc00::/7, link-local fe80::/10, v4-mapped ::ffff:)
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
      return true;
    }
    if (host.includes('::ffff:')) {
      const v4Part = host.split('::ffff:')[1];
      if (v4Part && /^\d+\.\d+\.\d+\.\d+$/.test(v4Part)) {
        return isPrivateIPv4(v4Part);
      }
      return true;
    }
  }

  return false;
}

export function validatePublicProbeUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) {
    return { ok: false, error: 'Probe URL must be between 1 and 500 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http:// and https:// protocols are supported.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials inside probe URLs are not allowed.' };
  }

  if (isUnsafeHost(parsed.hostname)) {
    return { ok: false, error: 'Private, loopback, or internal network targets are blocked.' };
  }

  return { ok: true, url: parsed };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateRunCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join('');
}

export function sanitizeSlug(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  const suffix = generateRunCode().toLowerCase().slice(0, 5);
  return `${base || 'runbook'}-${suffix}`;
}

export async function enforceRateLimit(
  kv: KVNamespace | undefined,
  bucket: string,
  ip: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  if (!kv) return { allowed: true, remaining: limit };
  const windowKey = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${bucket}:${ip}:${windowKey}`;
  const currentRaw = await kv.get(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0;
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 30 });
  return { allowed: true, remaining: Math.max(0, limit - current - 1) };
}
