'use client';

import { AssistantWorkspace } from '@/components/assistant/assistant-workspace';
import { ShieldAlert, ClipboardCheck, FileBarChart, Image as ImageIcon, Wrench, Sliders } from 'lucide-react';

const QUICK_QUESTIONS = [
  { icon: FileBarChart, text: '生成课题进展报告', desc: '汇总化合物/活性/合成/库存数据' },
  { icon: ImageIcon, text: '分析这张谱图或PPT', desc: '上传图片进行 VLM 视觉分析' },
  { icon: ShieldAlert, text: '风险态势分析', desc: '分析实验室整体安全风险' },
  { icon: ClipboardCheck, text: '审查建议', desc: '为待审批申请提供建议' },
  { icon: Wrench, text: '整改方案', desc: '针对安全隐患生成整改建议' },
  { icon: Sliders, text: '规则优化建议', desc: '优化实验室规则配置方向' },
];

export default function AdminAssistantPage() {
  return (
    <AssistantWorkspace
      role="admin"
      quickQuestions={QUICK_QUESTIONS}
      apiConfigPath="/admin/api-config"
      accent="indigo"
    />
  );
}
