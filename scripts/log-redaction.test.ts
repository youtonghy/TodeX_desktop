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
