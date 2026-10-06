"use client";

import { useState } from "react";
import Link from "next/link";
import {
  User,
  Mail,
  Phone,
  Building2,
  Shield,
  Edit3,
  Save,
  Camera,
  ClipboardList,
  ChevronRight,
  FileText,
  Cpu,
  Bell,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/auth-store";
import { ROLE_LABELS, type UserRole } from "@/types";

// 个人信息页快捷入口（从主导航移入，保持 profile 页作为个人中心聚合入口）
const quickLinks = [
  {
    label: "我的记录",
    description: "试剂领用、设备使用等历史活动",
    href: "/user/records",
    icon: ClipboardList,
    color: "bg-amber-50 text-amber-600",
  },
  {
    label: "我的申请",
    description: "查看试剂申请与审批进度",
    href: "/user/applications",
    icon: FileText,
    color: "bg-teal-50 text-teal-600",
  },
  {
    label: "设备预约",
    description: "管理设备预约与使用记录",
    href: "/user/equipment-apply",
    icon: Cpu,
    color: "bg-cyan-50 text-cyan-600",
  },
  {
    label: "我的通知",
    description: "查看系统与实验室通知",
    href: "/user/notifications",
    icon: Bell,
    color: "bg-orange-50 text-orange-600",
  },
];

interface ProfileForm {
  name: string;
  email: string;
  phone: string;
  labName: string;
}

const ADMIN_ROLES: UserRole[] = ["ADMIN"];

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: "",
    labName: user?.labName ?? "",
  });

  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;
  const roleLabel = user ? ROLE_LABELS[user.role] : "未知";
  const roleColor = isAdmin
    ? "border-blue-500 text-blue-600 bg-blue-50"
    : "border-emerald-500 text-emerald-600 bg-emerald-50";

  const handleSave = () => {
    // MVP: 本地状态保存，后续接入 API
    setIsEditing(false);
  };

  const handleCancel = () => {
    setForm({
      name: user?.name ?? "",
      email: user?.email ?? "",
      phone: "",
      labName: user?.labName ?? "",
    });
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* 个人信息头部 */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-2xl font-bold text-white shadow-lg shadow-emerald-500/20">
                {(user?.name ?? "用").charAt(0)}
              </div>
              <button className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition-colors">
                <Camera className="size-3.5" />
              </button>
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">
                {user?.name ?? "未知用户"}
              </h3>
              <p className="text-sm text-gray-500">
                {user?.email ?? "未设置邮箱"}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className={roleColor}>
                  <Shield className="size-3" />
                  {roleLabel}
                </Badge>
                {user?.labName && (
                  <Badge variant="outline" className="border-gray-300 text-gray-600 bg-gray-50">
                    <Building2 className="size-3" />
                    {user.labName}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 基本信息与快捷入口：PC 端并排（lg:grid-cols-2），移动端上下堆叠 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 详细信息 */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">基本信息</CardTitle>
              <CardDescription>您的账户基本信息</CardDescription>
            </div>
            {!isEditing ? (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Edit3 className="size-3.5" />
                编辑
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
                  <Save className="size-3.5" />
                  保存
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-gray-100">
              <div className="flex items-center gap-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                  <User className="size-4 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">姓名</p>
                  {isEditing ? (
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="mt-1"
                      placeholder="请输入姓名"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 truncate">{form.name || "未设置"}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                  <Mail className="size-4 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">邮箱</p>
                  {isEditing ? (
                    <Input
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="mt-1"
                      placeholder="请输入邮箱"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 truncate">{form.email || "未设置"}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                  <Phone className="size-4 text-purple-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">联系电话</p>
                  {isEditing ? (
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      className="mt-1"
                      placeholder="请输入联系电话"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 truncate">{form.phone || "未设置"}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                  <Building2 className="size-4 text-orange-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">所属实验室</p>
                  {isEditing ? (
                    <Input
                      value={form.labName}
                      onChange={(e) => setForm((f) => ({ ...f, labName: e.target.value }))}
                      className="mt-1"
                      placeholder="请输入实验室名称"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 truncate">{form.labName || "未设置"}</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 快捷入口：个人相关功能聚合（替代原侧边栏"我的记录"等入口） */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">快捷入口</CardTitle>
            <CardDescription>个人相关的常用功能</CardDescription>
          </CardHeader>
          <CardContent>
            {/* 移动端单列，PC端（lg+）两列；与左侧基本信息对齐填充空间 */}
            <div className="grid gap-3 sm:grid-cols-2">
              {quickLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-all hover:border-emerald-300 hover:bg-emerald-50/30 hover:shadow-sm"
                  >
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${link.color}`}>
                      <Icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-emerald-700">
                        {link.label}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {link.description}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-emerald-500" />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 账户安全提示 */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">账户与安全</CardTitle>
          <CardDescription>账户安全相关设置</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">登录方式</p>
                <p className="text-xs text-gray-500">当前使用演示账号登录</p>
              </div>
              <Badge variant="outline" className="border-emerald-500 text-emerald-600 bg-emerald-50 self-start sm:self-auto">
                演示模式
              </Badge>
            </div>
            <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">数据范围</p>
                <p className="text-xs text-gray-500">
                  {isAdmin
                    ? "可查看和管理所有实验室数据"
                    : "仅可查看和管理本人相关数据"}
                </p>
              </div>
              <Badge variant="outline" className={roleColor + " self-start sm:self-auto"}>
                {roleLabel}权限
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
