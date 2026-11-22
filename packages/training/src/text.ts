/** Accent- and case-insensitive search key: "developpe" matches "Développé". */
export function searchKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
