'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User as UserIcon, Building2, FileText, Save, Loader2, MapPin, Users,
  FlaskConical, Beaker, Pencil, Check, X, Filter, Clock, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs } from '@/arco-adapters/tabs';
import { Select } from '@/arco-adapters/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/store/auth-store';
import { ROLE_LABELS } from '@/types';
import { authFetch } from '@/lib/auth-fetch';
import { LlmConfigPanel } from '@/components/assistant/llm-config-panel';

interface LogEntry {
  id: string;
  type: string;       // reagent | requisition | device
  typeLabel: string;
  operator: string;
  detail: string;
  createdAt: string;
  status?: string;
}

interface LabInfo {
  id: string;
  name: string;
  location: string | null;
  school: string | null;
  college: string | null;
  description: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  joinCode: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { memberCount: number; reagentCount: number; deviceCount: number };
}

interface PaginatedLogs {
  data: LogEntry[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

async function fetchLogs(type: string): Promise<LogEntry[]> {
  const url = `/api/logs?pageSize=50${type ? `&type=${type}` : ''}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error('加载日志失败');
  const json: PaginatedLogs = await res.json();
  return json.data ?? [];
}

async function fetchLabInfo(): Promise<LabInfo> {
  const res = await authFetch('/api/labs/current');
  if (!res.ok) throw new Error('加载实验室信息失败');
  return res.json();
}

async function updateLabInfo(payload: { name?: string; location?: string; school?: string | null; college?: string | null; description?: string | null; workStartTime?: string | null; workEndTime?: string | null }): Promise<LabInfo> {
  const res = await authFetch('/api/labs/current', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? '保存失败');
  }
  return res.json();
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const LOG_TYPE_OPTIONS = [
  { value: '', label: '全部日志' },
  { value: 'reagent', label: '试剂台账' },
  { value: 'requisition', label: '领用申请' },
  { value: 'device', label: '设备使用' },
];

const LOG_TYPE_BADGE: Record<string, string> = {
  reagent: 'bg-blue-100 text-blue-800',
  requisition: 'bg-purple-100 text-purple-800',
  device: 'bg-teal-100 text-teal-800',
};

export default function AdminSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const queryClient = useQueryClient();
  const [editName, setEditName] = useState(user?.name ?? '');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 系统日志筛选
  const [logType, setLogType] = useState<string>('');

  // 实验室信息编辑
  const [editingLab, setEditingLab] = useState(false);
  const [labForm, setLabForm] = useState<{ name: string; location: string; school: string; college: string; description: string; workStartTime: string; workEndTime: string }>({
    name: '', location: '', school: '', college: '', description: '', workStartTime: '08:00', workEndTime: '22:30',
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['system-logs', logType],
    queryFn: () => fetchLogs(logType),
  });

  const { data: labInfo, isLoading: labLoading } = useQuery({
    queryKey: ['lab-info'],
    queryFn: fetchLabInfo,
  });

  const saveProfileMutation = useMutation({
    mutationFn: async (name: string) => { updateUser({ name }); return name; },
    onSuccess: () => {
      setSaveSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setTimeout(() => setSaveSuccess(false), 2000);
    },
  });

  const saveLabMutation = useMutation({
    mutationFn: updateLabInfo,
    onSuccess: (data) => {
      queryClient.setQueryData(['lab-info'], data);
      setEditingLab(false);
    },
  });

  // 进入编辑模式时，预填表单
  const startEditLab = () => {
    if (labInfo) {
      setLabForm({
        name: labInfo.name,
        location: labInfo.location ?? '',
        school: labInfo.school ?? '',
        college: labInfo.college ?? '',
        description: labInfo.description ?? '',
        workStartTime: labInfo.workStartTime ?? '08:00',
        workEndTime: labInfo.workEndTime ?? '22:30',
      });
    }
    setEditingLab(true);
  };

  const handleSaveLab = () => {
    saveLabMutation.mutate({
      name: labForm.name,
      location: labForm.location,
      school: labForm.school,
      college: labForm.college,
      description: labForm.description,
      workStartTime: labForm.workStartTime,
      workEndTime: labForm.workEndTime,
    });
  };

  const tabItems = [
    {
      key: 'profile',
      label: <span className="inline-flex items-center gap-1.5"><UserIcon className="size-4" />个人信息</span>,
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">个人信息</CardTitle><CardDescription>查看和编辑您的个人资料</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">姓名</Label>
                <div className="flex gap-2">
                  <Input id="name" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="请输入姓名" />
                  <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700" disabled={saveProfileMutation.isPending || editName === user?.name} onClick={() => saveProfileMutation.mutate(editName)}>
                    {saveProfileMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                  </Button>
                </div>
                {saveSuccess && <p className="text-xs text-blue-600">保存成功</p>}
              </div>
              <div className="space-y-2"><Label>邮箱</Label><Input value={user?.email ?? ''} disabled /></div>
              <div className="space-y-2"><Label>角色</Label><div className="flex h-8 items-center"><Badge variant="secondary">{user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] : '未知'}</Badge></div></div>
              <div className="space-y-2"><Label>所属实验室</Label><Input value={user?.labName ?? '未分配'} disabled /></div>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      key: 'lab',
      label: <span className="inline-flex items-center gap-1.5"><Building2 className="size-4" />实验室信息</span>,
      content: (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">实验室信息</CardTitle>
                <CardDescription>当前所属实验室的详细信息{user?.role === 'ADMIN' ? '（可编辑）' : ''}</CardDescription>
              </div>
              {!editingLab && labInfo && (
                <Button variant="outline" size="sm" onClick={startEditLab}>
                  <Pencil className="size-4" />编辑
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {labLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div>
            ) : labInfo ? (
              editingLab ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>实验室名称</Label>
                      <Input
                        value={labForm.name}
                        onChange={(e) => setLabForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="实验室名称"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>实验室位置</Label>
                      <Input
                        value={labForm.location}
                        onChange={(e) => setLabForm((f) => ({ ...f, location: e.target.value }))}
                        placeholder="实验室位置"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>学校</Label>
                      <Input
                        value={labForm.school}
                        onChange={(e) => setLabForm((f) => ({ ...f, school: e.target.value }))}
                        placeholder="如：XX大学"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>学院</Label>
                      <Input
                        value={labForm.college}
                        onChange={(e) => setLabForm((f) => ({ ...f, college: e.target.value }))}
                        placeholder="如：化学学院"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>实验室描述</Label>
                    <Textarea
                      value={labForm.description}
                      onChange={(e) => setLabForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="实验室描述（可选）"
                      rows={3}
                    />
                  </div>
                  {/* 工作时间设置（用于设备预约非常规时间判定）*/}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>工作时间开始</Label>
                      <Input
                        type="time"
                        value={labForm.workStartTime}
                        onChange={(e) => setLabForm((f) => ({ ...f, workStartTime: e.target.value }))}
                      />
                      <p className="text-[11px] text-gray-400">默认 08:00，用于设备预约常规时间判定</p>
                    </div>
                    <div className="space-y-2">
                      <Label>工作时间结束</Label>
                      <Input
                        type="time"
                        value={labForm.workEndTime}
                        onChange={(e) => setLabForm((f) => ({ ...f, workEndTime: e.target.value }))}
                      />
                      <p className="text-[11px] text-gray-400">默认 22:30，超出此时间为非常规（下班）时间</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700" disabled={saveLabMutation.isPending} onClick={handleSaveLab}>
                      {saveLabMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      保存修改
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingLab(false)} disabled={saveLabMutation.isPending}>
                      <X className="size-4" />取消
                    </Button>
                    {saveLabMutation.isError && (
                      <span className="text-xs text-red-600">{(saveLabMutation.error as Error).message}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label>实验室名称</Label><Input value={labInfo.name} disabled /></div>
                    <div className="space-y-2"><Label>实验室位置</Label><div className="flex h-9 items-center gap-2 text-sm text-gray-700"><MapPin className="size-4 text-gray-400" />{labInfo.location || '未设置'}</div></div>
                    <div className="space-y-2"><Label>学校</Label><Input value={labInfo.school || '未设置'} disabled /></div>
                    <div className="space-y-2"><Label>学院</Label><Input value={labInfo.college || '未设置'} disabled /></div>
                    <div className="space-y-2"><Label>加入码（6位）</Label><div className="flex h-9 items-center gap-2"><Input value={labInfo.joinCode ?? '未生成'} disabled className="font-mono text-sm tracking-widest" /><span className="text-[11px] text-gray-400 whitespace-nowrap">实验员凭此码注册加入</span></div></div>
                    <div className="space-y-2"><Label>创建时间</Label><div className="flex h-9 items-center text-sm text-gray-700">{new Date(labInfo.createdAt).toLocaleDateString('zh-CN')}</div></div>
                    <div className="space-y-2"><Label>工作时间</Label><div className="flex h-9 items-center gap-2 text-sm text-gray-700"><Clock className="size-4 text-gray-400" />{labInfo.workStartTime ?? '08:00'} - {labInfo.workEndTime ?? '22:30'}</div></div>
                  </div>
                  {labInfo.description && (
                    <div className="space-y-2"><Label>实验室描述</Label><div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">{labInfo.description}</div></div>
                  )}
                  <Separator />
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-100 bg-blue-50/50 p-4 text-center">
                      <Users className="mx-auto size-5 text-blue-500" />
                      <div className="mt-2 text-2xl font-bold text-blue-700">{labInfo.stats.memberCount}</div>
                      <div className="text-xs text-gray-500">成员数</div>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-teal-50/50 p-4 text-center">
                      <FlaskConical className="mx-auto size-5 text-teal-500" />
                      <div className="mt-2 text-2xl font-bold text-teal-700">{labInfo.stats.reagentCount}</div>
                      <div className="text-xs text-gray-500">试剂种类</div>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-orange-50/50 p-4 text-center">
                      <Beaker className="mx-auto size-5 text-orange-500" />
                      <div className="mt-2 text-2xl font-bold text-orange-700">{labInfo.stats.deviceCount}</div>
                      <div className="text-xs text-gray-500">设备数量</div>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="py-12 text-center text-sm text-gray-400">无法加载实验室信息</div>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      key: 'logs',
      label: <span className="inline-flex items-center gap-1.5"><FileText className="size-4" />系统日志</span>,
      content: (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">系统日志</CardTitle>
                <CardDescription>实验室最近的操作记录（试剂台账、领用申请、设备使用）</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-gray-400" />
                <Select
                  value={logType}
                  onChange={setLogType}
                  options={LOG_TYPE_OPTIONS}
                  placeholder="日志类型"
                  className="w-36"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-gray-400" /></div>
            ) : logs.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">暂无操作记录</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类型</TableHead>
                    <TableHead>操作人</TableHead>
                    <TableHead>详情</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={`${log.type}-${log.id}`}>
                      <TableCell>
                        <Badge className={`text-xs ${LOG_TYPE_BADGE[log.type] ?? 'bg-gray-100 text-gray-800'}`}>
                          {log.typeLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.operator}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm text-gray-600" title={log.detail}>{log.detail}</TableCell>
                      <TableCell>
                        {log.status ? <Badge variant="outline" className="text-xs">{log.status}</Badge> : <span className="text-xs text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs text-gray-400">{formatTime(log.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      key: 'api',
      label: <span className="inline-flex items-center gap-1.5"><KeyRound className="size-4" />API 配置</span>,
      content: <LlmConfigPanel mode="lab" />,
    },
  ];

  return (
    <div className="space-y-5">
      <Tabs defaultActiveKey="profile" items={tabItems} />
    </div>
  );
}
