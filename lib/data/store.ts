import { DataStore } from '@/lib/domain/types';
import { LocalStore } from '@/lib/data/local-store';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { hasSupabaseDataConfigured } from '@/lib/supabase/admin';

declare global {
  // eslint-disable-next-line no-var
  var __spanStore: DataStore | undefined;
}

export function getStore(): DataStore {
  if (!global.__spanStore) {
    global.__spanStore = hasSupabaseDataConfigured() ? new SupabaseStore() : new LocalStore();
  }
  return global.__spanStore;
}
