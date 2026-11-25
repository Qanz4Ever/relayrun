import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRunCode, sha256Hex, validatePublicProbeUrl } from '../src/worker/security.ts';

test('validatePublicProbeUrl accepts valid public HTTPS and HTTP URLs', () => {
  const okHttps = validatePublicProbeUrl('https://relayrun.mfsavana.web.id/api/demo-health');
  assert.equal(okHttps.ok, true);

  const okHttp = validatePublicProbeUrl('http://example.com/status');
  assert.equal(okHttp.ok, true);
});

test('validatePublicProbeUrl blocks SSRF private, loopback, metadata, and obfuscated IPs', () => {
  const blockedTargets = [
    'http://localhost:8787/api/health',
    'http://127.0.0.1/admin',
    'http://10.0.0.5/internal',
    'http://172.16.4.2/metrics',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/cgnat',
    'http://[::1]:8080/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'https://user:pass@example.com/secret',
    'ftp://example.com/file'
  ];

  for (const target of blockedTargets) {
    const res = validatePublicProbeUrl(target);
    assert.equal(res.ok, false, `Expected SSRF guard to block: ${target}`);
  }
});

test('sha256Hex produces deterministic 64-char hex digest', async () => {
  const digest = await sha256Hex('relayrun-test-key');
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, await sha256Hex('relayrun-test-key'));
});

test('generateRunCode produces 8-char uppercase unambiguous codes', () => {
  const code = generateRunCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[A-Z2-9]{8}$/);
});
