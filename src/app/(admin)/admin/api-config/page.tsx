"use client";

import { LlmConfigPanel } from "@/components/assistant/llm-config-panel";

export default function AdminApiConfigPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <LlmConfigPanel mode="lab" showBackButton />
    </div>
  );
}
