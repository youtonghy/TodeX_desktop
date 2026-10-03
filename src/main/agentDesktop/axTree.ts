/** CDP `Accessibility.AXNode`, the fields the snapshot uses. */
export type AXNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
};

export const MAX_TREE_CHARS = 64 * 1024;

/** Roles an agent can act on; they get `[ref=eN]`. */
const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
]);
/** Structural roles printed only through their children. */
const TRANSPARENT = new Set(['none', 'generic', 'InlineTextBox', 'LineBreak', 'RootWebArea', 'presentation']);
const STATES = ['focused', 'checked', 'disabled', 'expanded', 'selected', 'pressed', 'required'];

const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const quote = (value: string): string => JSON.stringify(value.replace(/\s+/g, ' ').trim().slice(0, 200));

/**
 * Indented text form of the page's accessibility tree. Interactive nodes get
 * refs mapped to their DOM backend node ids, valid until the next snapshot.
 */
export function formatAxTree(nodes: AXNode[]): { tree: string; refs: Map<string, number>; truncated: boolean } {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const root = nodes.find(node => !node.parentId || !byId.has(node.parentId));
  const refs = new Map<string, number>();
  const lines: string[] = [];
  let size = 0;
  let truncated = false;
  const visited = new Set<string>();

  const walk = (node: AXNode, depth: number, parentName: string) => {
    if (truncated || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    const role = text(node.role?.value);
    const name = text(node.name?.value).trim();
    const children = (node.childIds ?? []).map(id => byId.get(id)).filter((child): child is AXNode => Boolean(child));
    // Static text repeating its parent's accessible name adds nothing.
    const printed = !node.ignored && role && !(TRANSPARENT.has(role) && !name)
      && !(role === 'StaticText' && (!name || name === parentName));
    if (printed) {
      let line = `${'  '.repeat(depth)}- ${role === 'StaticText' ? 'text' : role}`;
      if (name) line += ` ${quote(name)}`;
      const value = text(node.value?.value);
      if (value && value !== name) line += ` value=${quote(value)}`;
      for (const property of node.properties ?? []) {
        if (STATES.includes(property.name) && property.value?.value) {
          line += property.value.value === true ? ` [${property.name}]` : ` [${property.name}=${text(property.value.value)}]`;
        }
      }
      if (INTERACTIVE.has(role) && node.backendDOMNodeId) {
        const ref = `e${refs.size + 1}`;
        refs.set(ref, node.backendDOMNodeId);
        line += ` [ref=${ref}]`;
      }
      if (size + line.length + 1 > MAX_TREE_CHARS) {
        truncated = true;
        return;
      }
      size += line.length + 1;
      lines.push(line);
    }
    if (role === 'StaticText') return;
    for (const child of children) walk(child, printed ? depth + 1 : depth, printed ? name : parentName);
  };
  if (root) walk(root, 0, '');
  return { tree: lines.join('\n'), refs, truncated };
}
