import { redirect } from 'next/navigation';
import { resolveCurrentUserId } from '@/lib/auth/session';

export default async function HomePage() {
  try {
    const userId = await resolveCurrentUserId();
    if (!userId) {
      redirect('/login');
    }
    redirect('/planner');
  } catch {
    redirect('/login');
  }
}
