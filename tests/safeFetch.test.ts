import { describe, expect, it } from 'vitest';
import {
  isPublicIpAddress,
  parsePublicHttpUrl,
  resolvePublicAddresses,
} from '../lib/safeFetch';

describe('safe outbound URL validation', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('accepts ordinary public unicast addresses', () => {
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects unsafe schemes, credentials, localhost, and private literals', () => {
    expect(() => parsePublicHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => parsePublicHttpUrl('https://user:pass@example.com/')).toThrow();
    expect(() => parsePublicHttpUrl('http://localhost/admin')).toThrow();
    expect(() => parsePublicHttpUrl('http://169.254.169.254/latest/meta-data')).toThrow();
  });

  it('rejects hostnames when any DNS answer is non-public', async () => {
    await expect(resolvePublicAddresses(
      new URL('https://feed.example/rss.xml'),
      async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.4', family: 4 },
      ]
    )).rejects.toThrow(/private, local, or reserved/);
  });
});
