// Fixed display order for the product catalog - Frutas/Verduras first (what people
// actually look for), everything else (Otros, or any future category) alphabetically
// after. Prisma can't express a custom string ordering directly, so products are
// fetched in their normal orderBy (category asc, sort_order asc, name asc) and then
// re-sorted here - a stable sort, so the existing sort_order/name ordering within each
// category is preserved, only the category GROUPS get reordered.
const CATEGORY_PRIORITY = ['Frutas', 'Verduras', 'Otros'];

export function sortByCategoryOrder<T extends { category: string | null }>(products: T[]): T[] {
  return [...products].sort((a, b) => {
    const aIdx = CATEGORY_PRIORITY.indexOf(a.category ?? '');
    const bIdx = CATEGORY_PRIORITY.indexOf(b.category ?? '');
    const aRank = aIdx === -1 ? CATEGORY_PRIORITY.length : aIdx;
    const bRank = bIdx === -1 ? CATEGORY_PRIORITY.length : bIdx;
    if (aRank !== bRank) return aRank - bRank;
    if (aRank === CATEGORY_PRIORITY.length) return (a.category ?? '').localeCompare(b.category ?? '');
    return 0;
  });
}
