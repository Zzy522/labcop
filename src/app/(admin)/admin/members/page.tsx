"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UserPlus,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/arco-adapters/tabs";
import { Dialog } from "@/arco-adapters/dialog";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth-fetch";
import { ROLE_LABELS } from "@/types";
import { DeleteMemberButton } from '@/components/delete-member-button';
import { useAuthStore } from '@/store/auth-store';

interface JoinRequestItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: string; // PENDING | APPROVED | REJECTED
  message: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface LabMember {
  labRole?: string;
  id: string;
  name: string;
  role: string;
  email: string;
}

const JOIN_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "待审批", className: "border-orange-500 text-orange-600 bg-orange-50" },
  APPROVED: { label: "已通过", className: "border-green-500 text-green-600 bg-green-50" },
  REJECTED: { label: "已拒绝", className: "border-purple-500 text-purple-600 bg-purple-50" },
};

async function fetchJoinRequests(status: string): Promise<JoinRequestItem[]> {
  const res = await authFetch(`/api/labs/current/join-requests?status=${status}&pageSize=100`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "加载入组申请失败");
  }
  const json = await res.json();
  return json.data ?? [];
}

async function fetchMembers(): Promise<LabMember[]> {
  const res = await authFetch("/api/labs/members");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "加载成员失败");
  }
  const json = await res.json();
  return json.data ?? [];
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminMembersPage() {
  const currentUser = useAuthStore(s => s.user);
  const [pendingRequests, setPendingRequests] = useState<JoinRequestItem[]>([]);
  const [allRequests, setAllRequests] = useState<JoinRequestItem[]>([]);
  const [members, setMembers] = useState<LabMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pending, all, memberList] = await Promise.all([
        fetchJoinRequests("PENDING"),
        fetchJoinRequests("all"),
        fetchMembers(),
      ]);
      setPendingRequests(pending);
      setAllRequests(all);
      setMembers(memberList);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 通过
  const handleApprove = useCallback(async (id: string) => {
    setActionError(null);
    setReviewingId(id);
    try {
      const res = await authFetch(`/api/join-requests/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "审批失败");
      }
      await fetchAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "审批失败");
    } finally {
      setReviewingId(null);
    }
  }, [fetchAll]);

  // 拒绝（打开确认框）
  const handleRejectClick = useCallback((id: string) => {
    setRejectingId(id);
    setRejectReason("");
    setRejectDialogOpen(true);
  }, []);

  const handleRejectConfirm = useCallback(async () => {
    if (!rejectingId) return;
    setActionError(null);
    setReviewingId(rejectingId);
    setRejectDialogOpen(false);
    try {
      const res = await authFetch(`/api/join-requests/${rejectingId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejectReason: rejectReason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "审批失败");
      }
      await fetchAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "审批失败");
    } finally {
      setReviewingId(null);
      setRejectingId(null);
    }
  }, [rejectingId, rejectReason, fetchAll]);

  const renderStatusBadge = (status: string) => {
    const config = JOIN_STATUS_CONFIG[status] || JOIN_STATUS_CONFIG.PENDING;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  // ── 入组申请表格 ──
  const renderRequestTable = (items: JoinRequestItem[], showActions: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>申请人</TableHead>
          <TableHead>邮箱</TableHead>
          <TableHead>申请留言</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>申请时间</TableHead>
          {showActions && <TableHead>操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 6 : 5} className="py-8 text-center text-gray-500">暂无入组申请</TableCell>
          </TableRow>
        ) : (
          items.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.userName || "未命名用户"}</TableCell>
              <TableCell className="text-sm text-gray-600">{r.userEmail}</TableCell>
              <TableCell className="max-w-56 truncate text-sm text-gray-600" title={r.message ?? ""}>
                {r.message ? (
                  <span className="inline-flex items-center gap-1"><MessageSquareText className="size-3.5 text-gray-400" />{r.message}</span>
                ) : <span className="text-gray-400">—</span>}
              </TableCell>
              <TableCell>{renderStatusBadge(r.status)}</TableCell>
              <TableCell className="text-sm text-gray-500">{formatTime(r.createdAt)}</TableCell>
              {showActions && (
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-500 text-green-600 hover:bg-green-50"
                      disabled={reviewingId === r.id}
                      onClick={() => handleApprove(r.id)}
                    >
                      {reviewingId === r.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                      通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500 text-red-600 hover:bg-red-50"
                      disabled={reviewingId === r.id}
                      onClick={() => handleRejectClick(r.id)}
                    >
                      <XCircle className="size-3" />
                      拒绝
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  // ── 成员表格 ──
  const renderMemberTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>姓名</TableHead>
          <TableHead>邮箱</TableHead>
          <TableHead>角色</TableHead>
          <TableHead>账号操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-gray-500">暂无成员</TableCell>
          </TableRow>
        ) : (
          members.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name || "未命名用户"}</TableCell>
              <TableCell className="text-sm text-gray-600">{m.email}</TableCell>
              <TableCell>
                <Badge variant={m.role === "ADMIN" ? "default" : "secondary"}>
                  {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}
                </Badge>
              </TableCell>
              <TableCell>{m.id !== currentUser?.id && m.labRole !== 'LAB_OWNER' && <DeleteMemberButton id={m.id} name={m.name} onDeleted={fetchAll} />}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  const loadingEl = (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="size-6 animate-spin text-gray-400" />
      <span className="ml-2 text-gray-500">加载中...</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {(actionError || loadError) && (
        <Alert variant="destructive">
          <AlertDescription>{actionError || loadError}</AlertDescription>
        </Alert>
      )}

      <Tabs
        items={[
          {
            key: "pending",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <UserPlus className="size-4" />
                入组申请
                {pendingRequests.length > 0 && (
                  <Badge variant="outline" className="border-orange-500 text-orange-600">{pendingRequests.length}</Badge>
                )}
              </span>
            ),
            content: (
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                    <Clock3 className="size-4 text-orange-600" />
                    待审批的成员加入申请
                    {pendingRequests.length > 0 && (
                      <Badge variant="outline" className="border-orange-500 text-orange-600">{pendingRequests.length} 项</Badge>
                    )}
                  </div>
                  {loading ? loadingEl : renderRequestTable(pendingRequests, true)}
                </CardContent>
              </Card>
            ),
          },
          {
            key: "history",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-4" />
                历史申请
              </span>
            ),
            content: (
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                    <ShieldCheck className="size-4 text-slate-500" />
                    全部入组申请（含历史）
                  </div>
                  {loading ? loadingEl : renderRequestTable(allRequests, false)}
                </CardContent>
              </Card>
            ),
          },
          {
            key: "members",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-4" />
                成员列表
              </span>
            ),
            content: (
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium text-gray-700">
                    <Users className="size-4 text-blue-600" />
                    实验室成员
                    <Badge variant="outline" className="border-blue-500 text-blue-600">{members.length} 人</Badge>
                  </div>
                  {loading ? loadingEl : renderMemberTable()}
                </CardContent>
              </Card>
            ),
          },
        ]}
      />

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="拒绝入组申请"
        description="请输入拒绝原因，便于反馈给申请人"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleRejectConfirm} disabled={reviewingId === rejectingId}>
              {reviewingId === rejectingId ? <Loader2 className="size-4 animate-spin" /> : null}
              确认拒绝
            </Button>
          </>
        }
      >
        <div className="py-2">
          <Textarea
            placeholder="请输入拒绝原因..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
        </div>
      </Dialog>
    </div>
  );
}
