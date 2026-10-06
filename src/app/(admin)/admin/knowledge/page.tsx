'use client';

import { KnowledgeHub } from '@/components/knowledge/knowledge-hub';

export default function AdminKnowledgePage() {
  return <KnowledgeHub isAdmin={true} />;
}
