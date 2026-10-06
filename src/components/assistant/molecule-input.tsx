'use client';

import { useState } from 'react';
import { Modal } from '@arco-design/web-react';
import { Atom } from 'lucide-react';
import { KetcherEditor } from '@/components/ketcher-editor';
import { getStandardSmiles, type KetcherApi } from '@/lib/ketcher';

export function MoleculeInput({ disabled, onInsert }: { disabled?: boolean; onInsert: (smiles: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<KetcherApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function insert() {
    if (!editor || busy) return;
    setBusy(true); setError('');
    try {
      const smiles = (await getStandardSmiles(editor)).trim();
      if (!smiles) throw new Error('请先绘制分子结构');
      if (smiles.length > 20000) throw new Error('结构过大，请简化后再插入');
      onInsert(smiles); setOpen(false); setEditor(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'SMILES 导出失败'); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" title="绘制分子并插入 SMILES" aria-label="绘制分子并插入 SMILES" disabled={disabled} onClick={() => { setEditor(null); setError(''); setOpen(true); }} className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-teal-200 text-teal-600 disabled:opacity-40"><Atom className="size-4" /></button>
    <Modal visible={open} title="绘制分子结构" style={{ width: 'min(960px, 96vw)' }} wrapStyle={{ zIndex: 10050 }} unmountOnExit maskClosable={false} onCancel={() => { if (!busy) { setOpen(false); setEditor(null); } }} onOk={() => void insert()} okText="插入 SMILES" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !editor || busy }}>
      <p className="mb-3 text-sm text-gray-500">绘制后转为标准 SMILES，加入当前输入框，可继续编辑后发送。</p>
      {open && <KetcherEditor onInit={setEditor} onError={message => { setError(message); setEditor(null); }} />}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </Modal>
  </>;
}
