'use client';

import { AssistantWorkspace } from '@/components/assistant/assistant-workspace';
import { FlaskConical, ShieldCheck, BookOpen, Image as ImageIcon } from 'lucide-react';

const QUICK_QUESTIONS = [
  { icon: FlaskConical, text: '危化品存储有哪些注意事项？' },
  { icon: ShieldCheck, text: '领用申请被阻断怎么办？' },
  { icon: BookOpen, text: '实验室安全操作规程概览' },
  { icon: ImageIcon, text: '分析这张谱图/照片', },
];

export default function AssistantPage() {
  return (
    <AssistantWorkspace
      role="user"
      quickQuestions={QUICK_QUESTIONS}
      apiConfigPath="/user/api-config"
      accent="teal"
    />
  );
}
