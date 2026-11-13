import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMeshBeacon } from '../src/main/meshBeacons.ts';

const packet = (value: unknown) => Buffer.from(JSON.stringify(value));

test('a node beacon names the node and its port', () => {
  assert.deepEqual(
    parseMeshBeacon(packet({ t: 'todex-mesh-beacon', v: 1, nodeId: 'node_ZvJFxWP4KDiBfMIH', port: 7345 }), '192.168.1.20', 5),
    { nodeId: 'node_ZvJFxWP4KDiBfMIH', address: '192.168.1.20', port: 7345, seenAt: 5 },
  );
});

test('anything else on the port is ignored', () => {
  assert.equal(parseMeshBeacon(Buffer.from('hello'), '10.0.0.1'), null);
  assert.equal(parseMeshBeacon(packet({ t: 'todex-mesh-beacon', v: 2, nodeId: 'node_ZvJFxWP4KDiBfMIH', port: 7345 }), '10.0.0.1'), null);
  assert.equal(parseMeshBeacon(packet({ t: 'todex-mesh-beacon', v: 1, nodeId: 'dev_ZvJFxWP4KDiBfMIH', port: 7345 }), '10.0.0.1'), null);
  assert.equal(parseMeshBeacon(packet({ t: 'todex-mesh-beacon', v: 1, nodeId: 'node_ZvJFxWP4KDiBfMIH', port: 70000 }), '10.0.0.1'), null);
  assert.equal(parseMeshBeacon(Buffer.alloc(600, 32), '10.0.0.1'), null);
});
