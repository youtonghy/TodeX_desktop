/* The 山海经 model periodic table, an easter egg behind a long press on the
 * model picker. Cells follow the periodic table's 7 periods and 18 groups
 * without the f-block rows, so periods 6 and 7 leave group 3 empty and skip
 * the 15 lanthanides or actinides, as in a standard table. Each cell holds one creature from
 * the Classic of Mountains and Seas; `glyph` is the character shown in the
 * cell, and every glyph is distinct. */

export interface ShanhaiCell {
  /** Atomic number of the element in this position. */
  number: number;
  /** 1-based period (grid row). */
  row: number;
  /** 1-based group (grid column). */
  column: number;
  glyph: string;
  name: string;
}

const CREATURES: ReadonlyArray<readonly [name: string, glyph: string]> = [
  ['鲲鹏', '鹏'], ['凤凰', '凤'], ['麒麟', '麟'], ['白泽', '泽'], ['九尾狐', '狐'],
  ['烛龙', '烛'], ['应龙', '应'], ['夔牛', '夔'], ['饕餮', '饕'], ['穷奇', '穷'],
  ['梼杌', '梼'], ['帝江', '江'], ['毕方', '毕'], ['精卫', '卫'], ['青鸟', '青'],
  ['重明鸟', '明'], ['狰', '狰'], ['当康', '康'], ['鹿蜀', '蜀'], ['文鳐鱼', '鳐'],
  ['何罗鱼', '罗'], ['横公鱼', '横'], ['旋龟', '旋'], ['天狗', '狗'], ['腓腓', '腓'],
  ['乘黄', '乘'], ['驳', '驳'], ['狡', '狡'], ['狌狌', '狌'], ['犀渠', '犀'],
  ['举父', '举'], ['蛊雕', '雕'], ['朱厌', '厌'], ['英招', '英'], ['陆吾', '吾'],
  ['开明兽', '开'], ['相柳', '柳'], ['刑天', '刑'], ['祝融', '融'], ['句芒', '芒'],
  ['蓐收', '蓐'], ['禺强', '禺'], ['鬼车', '车'], ['鸾鸟', '鸾'], ['比翼鸟', '翼'],
  ['并封', '封'], ['肥遗', '遗'], ['鸣蛇', '鸣'], ['化蛇', '化'], ['巴蛇', '巴'],
  ['长右', '右'], ['猾褢', '猾'], ['蠃鱼', '蠃'], ['夫诸', '诸'], ['讹兽', '讹'],
  ['獬豸', '豸'], ['孟极', '极'], ['诸怀', '怀'], ['天马', '马'], ['飞鼠', '鼠'],
  ['领胡', '胡'], ['象蛇', '象'], ['酸与', '酸'], ['凫徯', '凫'], ['狍鸮', '鸮'],
  ['九凤', '九'], ['强良', '良'], ['天吴', '吴'], ['雨师妾', '雨'], ['雷神', '雷'],
  ['夸父', '夸'], ['羲和', '羲'], ['狸力', '狸'], ['类', '类'], ['灌灌', '灌'],
  ['数斯', '斯'], ['蜚', '蜚'], ['蛮蛮', '蛮'], ['文文', '文'], ['青耕', '耕'],
  ['狙如', '狙'], ['山膏', '膏'], ['吉量', '量'], ['驺吾', '驺'], ['耳鼠', '耳'],
  ['幽鴳', '幽'], ['足訾', '訾'], ['竦斯', '竦'],
];

/** Groups filled in each period once the f-block rows are left out. */
function periodColumns(period: number): number[] {
  const all = Array.from({ length: 18 }, (_, index) => index + 1);
  if (period === 1) return [1, 18];
  if (period <= 3) return all.filter((column) => column <= 2 || column >= 13);
  if (period <= 5) return all;
  return all.filter((column) => column !== 3);
}

function buildCells(): ShanhaiCell[] {
  const cells: ShanhaiCell[] = [];
  let number = 0;
  for (let row = 1; row <= 7; row += 1) {
    for (const column of periodColumns(row)) {
      number += 1;
      // The lanthanides (57-71) and actinides (89-103) fill the gap left by
      // group 3 in periods 6 and 7.
      if (row >= 6 && column === 4) number += 15;
      const [name, glyph] = CREATURES[cells.length];
      cells.push({ number, row, column, glyph, name });
    }
  }
  return cells;
}

export const SHANHAI_CELLS: readonly ShanhaiCell[] = buildCells();

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

/**
 * Deals the models onto the table at random: index `i` of the result is the
 * model in `SHANHAI_CELLS[i]`. Every cell gets a model, and every model gets
 * at least one cell as long as there are no more models than cells. Returns
 * an empty array when there are no models.
 */
export function assignShanhaiModels<T>(models: readonly T[], random: () => number = Math.random): T[] {
  if (models.length === 0) return [];
  const order = shuffle([...models], random);
  const dealt = SHANHAI_CELLS.map((_, index) => order[index % order.length]);
  return shuffle(dealt, random);
}
