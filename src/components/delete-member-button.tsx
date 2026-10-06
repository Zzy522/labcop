'use client';
import { useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';

export function DeleteMemberButton({ id, name, platform = false, onDeleted }: { id: string; name: string; platform?: boolean; onDeleted: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    const reason = window.prompt(`删除「${name}」的登录账号。原有上传资料、文档版本和历史记录保留，原邮箱可重新注册；新账号不会自动继承权限。\n请填写删除原因：`);
    if (!reason?.trim()) return;
    if (!window.confirm(`确认删除「${name}」账号并立即撤销登录？业务资料保留。`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/${platform ? 'platform/users' : 'labs/members'}/${id}`, { method: 'DELETE', body: JSON.stringify({ reason, confirm: true }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '删除失败');
      await onDeleted();
      window.alert(result.message);
    } catch (error) { window.alert(error instanceof Error ? error.message : '删除失败，请重试'); }
    finally { setBusy(false); }
  }
  return <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-500 disabled:opacity-50">{busy ? '删除中…' : '删除账号（保留资料）'}</button>;
}
