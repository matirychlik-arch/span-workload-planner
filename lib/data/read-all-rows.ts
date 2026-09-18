type Page<T> = { data: T[] | null; error: { message: string } | null };

// Supabase caps a response at 1,000 rows by default. A recurring calendar can
// exceed that even when only a few tasks repeat; never silently drop history.
export async function readAllRows<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const result = await page(offset, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
}
