import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TREE_CHARS, formatAxTree, type AXNode } from '../src/main/agentDesktop/axTree.ts';

const node = (nodeId: string, role: string, name = '', extra: Partial<AXNode> = {}): AXNode => ({
  nodeId, role: { value: role }, name: { value: name }, ...extra,
});

test('interactive nodes get refs; structure and text collapse into an indented tree', () => {
  const nodes: AXNode[] = [
    node('1', 'RootWebArea', 'Dev', { childIds: ['2', '3'] }),
    node('2', 'generic', '', { parentId: '1', childIds: ['4', '5'] }),
    node('3', 'heading', 'Sign in', { parentId: '1', childIds: ['6'] }),
    node('4', 'textbox', 'Email', { parentId: '2', backendDOMNodeId: 41, value: { value: 'a@b.c' }, properties: [{ name: 'focused', value: { value: true } }] }),
    node('5', 'button', 'Continue', { parentId: '2', backendDOMNodeId: 52, properties: [{ name: 'disabled', value: { value: true } }] }),
    node('6', 'StaticText', 'Sign in', { parentId: '3' }),
    node('7', 'button', 'hidden', { parentId: '2', ignored: true }),
  ];
  const { tree, refs, truncated } = formatAxTree(nodes);
  assert.equal(tree, [
    '- RootWebArea "Dev"',
    '  - textbox "Email" value="a@b.c" [focused] [ref=e1]',
    '  - button "Continue" [disabled] [ref=e2]',
    '  - heading "Sign in"',
  ].join('\n'));
  assert.deepEqual([...refs], [['e1', 41], ['e2', 52]]);
  assert.equal(truncated, false);
});

test('huge pages are cut at the size limit and cycles terminate', () => {
  const children = Array.from({ length: 5000 }, (_, i) => `c${i}`);
  const nodes: AXNode[] = [
    node('root', 'RootWebArea', 'Big', { childIds: [...children, 'root'] }),
    ...children.map(id => node(id, 'link', `link number ${id} with a long accessible name`, { parentId: 'root', backendDOMNodeId: 1 })),
  ];
  const { tree, truncated } = formatAxTree(nodes);
  assert.equal(truncated, true);
  assert.ok(tree.length <= MAX_TREE_CHARS);
});
