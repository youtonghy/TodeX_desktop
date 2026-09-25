import type { MarkdownProps } from '@heroui-pro/react/markdown';

/* Tables do not honor `overflow` themselves; a wide table's min-content
   would propagate its scrollable overflow up to the chat scroll container
   and make the whole conversation draggable horizontally. Wrapping each
   table in its own scroll track contains the overflow. */
export const baseMarkdownComponents: NonNullable<MarkdownProps['components']> = {
  table: ({ node: _node, ref: _ref, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};
