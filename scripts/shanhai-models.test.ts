import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignShanhaiModels, SHANHAI_CELLS } from '../src/renderer/components/shanhaiModels.ts';

/** mulberry32: a small seeded generator, so a deal can be replayed. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('lays out the 88 cells of the periodic table without the f-block', () => {
  assert.equal(SHANHAI_CELLS.length, 88);
  assert.equal(new Set(SHANHAI_CELLS.map((cell) => `${cell.row}:${cell.column}`)).size, 88);
  assert.equal(new Set(SHANHAI_CELLS.map((cell) => cell.glyph)).size, 88);
  assert.ok(SHANHAI_CELLS.every((cell) => [...cell.glyph].length === 1 && cell.name.includes(cell.glyph)));
  const at = (row: number, column: number) => SHANHAI_CELLS.find((cell) => cell.row === row && cell.column === column)?.number;
  assert.equal(at(1, 1), 1);
  assert.equal(at(1, 18), 2);
  assert.equal(at(4, 3), 21);
  assert.equal(at(6, 2), 56);
  assert.equal(at(6, 3), undefined);
  assert.equal(at(6, 4), 72);
  assert.equal(at(7, 18), 118);
});

test('deals every model onto at least one cell', () => {
  const models = ['opus', 'sonnet', 'haiku'];
  const dealt = assignShanhaiModels(models, seeded(7));
  assert.equal(dealt.length, SHANHAI_CELLS.length);
  assert.deepEqual(new Set(dealt), new Set(models));
  assert.deepEqual(assignShanhaiModels(['solo']), Array(88).fill('solo'));
});

test('replays the same deal for the same random sequence', () => {
  const models = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(assignShanhaiModels(models, seeded(42)), assignShanhaiModels(models, seeded(42)));
  assert.notDeepEqual(assignShanhaiModels(models, seeded(1)), assignShanhaiModels(models, seeded(2)));
});

test('leaves the table empty without models', () => {
  assert.deepEqual(assignShanhaiModels([]), []);
});
