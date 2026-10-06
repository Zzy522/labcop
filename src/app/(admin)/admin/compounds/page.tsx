'use client';

import { CompoundKnowledge } from '@/components/compound/compound-knowledge';

export default function AdminCompoundsPage() {
  // 管理员可编辑所有化合物，且可删除任意化合物
  return <CompoundKnowledge canEdit isAdmin />;
}
