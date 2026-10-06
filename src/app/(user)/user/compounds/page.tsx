'use client';

import { CompoundKnowledge } from '@/components/compound/compound-knowledge';

export default function UserCompoundsPage() {
  // 实验员可上传化合物、添加合成批次/生物活性测试等子资源
  // 仅可删除自己创建的化合物（component 内部判断 createdById === currentUser.id）
  return <CompoundKnowledge canEdit isAdmin={false} />;
}
