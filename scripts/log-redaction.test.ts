import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactUrlQuery } from '../src/renderer/lib/logRedaction.ts';

test('query values are dropped while names, host and path stay', () => {
  assert.equal(
    redactUrlQuery('wss://host.example:7345/v2/ws?enc=x25519&client_key=abc&auth_sig=s1&auth_sig=s2'),
    'wss://host.example:7345/v2/ws?enc=[redacted]&client_key=[redacted]&auth_sig=[redacted]',
  );
  assert.equal(redactUrlQuery('http://127.0.0.1:7345/health'), 'http://127.0.0.1:7345/health');
});

test('unparseable URLs still lose everything after the query mark', () => {
  assert.equal(redactUrlQuery('/v2/ws?auth_sig=secret'), '/v2/ws?[redacted]');
  assert.equal(redactUrlQuery('not a url'), 'not a url');
});

test('main-process logs drop URL query values, tokens, signatures and verification codes', async () => {
  const { isSensitiveLogKey, redactForLog } = await import('../src/main/debugLogger.ts');
  for (const key of ['token', 'authToken', 'accessToken', 'refresh_token', 'secret', 'deviceSecret', 'signature', 'sig', 'auth_sig', 'authSig', 'verificationCode', 'password']) {
    assert.equal(isSensitiveLogKey(key), true, key);
  }
  for (const key of ['inputTokens', 'tokenCount', 'signal', 'design', 'code', 'exitCode', 'status', 'url']) {
    assert.equal(isSensitiveLogKey(key), false, key);
  }
  assert.deepEqual(redactForLog({ authToken: 'a', code: 404, nested: { verification_code: '12345-67890' } }), {
    authToken: '[REDACTED]',
    code: 404,
    nested: { verification_code: '[REDACTED]' },
  });
  assert.equal(
    redactForLog('open todex-ipc://local/v2/ws?device_id=d1&auth_sig=s1&client_key=k1 failed'),
    'open todex-ipc://local/v2/ws?device_id=[redacted]&auth_sig=[redacted]&client_key=[redacted] failed',
  );
  assert.equal(redactForLog('token=abc; signature: xyz'), 'token=[REDACTED]; signature: [REDACTED]');
  assert.equal(redactForLog('plain message with 3 tokens'), 'plain message with 3 tokens');
});
