'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import type { UserRole } from '@/types';

const ADMIN_ROLES: UserRole[] = ['ADMIN'];

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else if (user.status && user.status !== 'ACTIVE') {
      router.replace('/application-status');
    } else if (user.platformRole === 'PLATFORM_ADMIN') {
      router.replace('/platform');
    } else if (ADMIN_ROLES.includes(user.role)) {
      router.replace('/admin');
    } else {
      router.replace('/user');
    }
  }, [user, router]);

  return null;
}
