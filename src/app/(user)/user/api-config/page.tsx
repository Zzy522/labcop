"use client";

import { LlmConfigPanel } from "@/components/assistant/llm-config-panel";

export default function UserApiConfigPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <LlmConfigPanel mode="personal" showBackButton />
    </div>
  );
}
