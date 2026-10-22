// Type-to-filter for long lists (states, districts, localities): "hi" finds Delhi and Himachal Pradesh, "him" only
// Himachal Pradesh. Letter case, dots and extra spaces do not matter. Names that start with the text come first, then
// names with a word that starts with it, then the rest; the list's own order is kept within each group.

const fold = (s: string) => s.toLowerCase().replace(/[.\s]+/g, ' ').trim();

export function filterByText<T>(items: readonly T[], text: string, nameOf: (item: T) => string): T[] {
  const q = fold(text);
  if (!q) return [...items];
  const starts: T[] = [];
  const words: T[] = [];
  const inside: T[] = [];
  for (const item of items) {
    const name = fold(nameOf(item));
    if (name.startsWith(q)) starts.push(item);
    else if (name.includes(` ${q}`) || name.includes(`(${q}`)) words.push(item);
    else if (name.includes(q) || name.replace(/ /g, '').includes(q.replace(/ /g, ''))) inside.push(item);
  }
  return [...starts, ...words, ...inside];
}
