import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicTarget } from './guard';

describe('isPrivateAddress', () => {
  it('flags loopback and unspecified', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '::']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('flags RFC1918 ranges at their edges', () => {
    for (const ip of ['10.0.0.0', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('does not flag public addresses that merely look nearby', () => {
    for (const ip of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '8.8.8.8', '1.1.1.1', '160.254.1.1']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it('flags the cloud metadata link-local address', () => {
    // 169.254.169.254 is the single most valuable SSRF target on any cloud host.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('flags CGNAT, benchmarking, documentation and multicast space', () => {
    for (const ip of ['100.64.0.1', '100.127.255.255', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('100.63.0.1')).toBe(false);
    expect(isPrivateAddress('100.128.0.1')).toBe(false);
  });

  it('flags IPv6 unique-local, link-local and multicast', () => {
    for (const ip of ['fc00::1', 'fd12:3456::1', 'fe80::1', '[fe80::1]', 'ff02::1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('sees through IPv4-mapped IPv6 forms', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('refuses malformed IPv4 rather than guessing', () => {
    expect(isPrivateAddress('999.1.1.1')).toBe(false); // not an IP at all — caller resolves it
  });
});

describe('assertPublicTarget', () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      saved[k] = process.env[k];
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('allows private targets outside production so local proxies keep working', async () => {
    await withEnv({ NODE_ENV: 'development', ALLOW_PRIVATE_ENDPOINTS: undefined }, async () => {
      await expect(assertPublicTarget('http://localhost:4000/v1/messages')).resolves.toBeUndefined();
    });
  });

  it('blocks loopback, metadata and .internal names in production', async () => {
    await withEnv({ NODE_ENV: 'production', ALLOW_PRIVATE_ENDPOINTS: undefined }, async () => {
      for (const url of [
        'http://127.0.0.1:8080/v1/messages',
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost/v1/messages',
        'http://metadata.google.internal/v1/messages',
        'http://admin.internal/v1/messages',
        'http://10.1.2.3/v1/messages',
      ]) {
        await expect(assertPublicTarget(url)).rejects.toThrow();
      }
    });
  });

  it('lets a host opt back in explicitly', async () => {
    await withEnv({ NODE_ENV: 'production', ALLOW_PRIVATE_ENDPOINTS: '1' }, async () => {
      await expect(assertPublicTarget('http://127.0.0.1:8080/v1/messages')).resolves.toBeUndefined();
    });
  });

  it('rejects a URL it cannot parse', async () => {
    await withEnv({ NODE_ENV: 'production', ALLOW_PRIVATE_ENDPOINTS: undefined }, async () => {
      await expect(assertPublicTarget('not a url')).rejects.toThrow();
    });
  });
});
