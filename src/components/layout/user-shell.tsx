"use client";

import { AuthorCredit } from '@/components/author-credit';

import { useState, useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Bell, LogOut } from "lucide-react";
import { Drawer } from "@/arco-adapters/drawer";
import { Button } from "@/components/ui/button";
import { UserSidebar } from "./user-sidebar";
import { FloatingChat } from "@/components/assistant/floating-chat";
import { OnboardingGuide, OnboardingLauncher } from "@/components/onboarding/onboarding-guide";
import { useAuthStore } from "@/store/auth-store";
import { ROLE_LABELS } from "@/types";

const pageTitles: Record<string, string> = {
  "/user": "我的工作台",
  "/user/applications": "我的申请",
  "/user/equipment-apply": "仪器设备预约",
  "/user/alerts": "试剂库总览",
  "/user/upload": "试剂入库",
  "/user/records": "我的记录",
  "/user/notifications": "我的通知",
  "/user/assistant": "智能助手",
  "/user/knowledge": "课题知识库",
  "/user/profile": "个人信息",
  "/user/inspections": "我的巡检任务",
  "/user/compounds": "化合物知识库",
  "/user/api-config": "API 配置",
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/user/reagents/")) return "试剂详情";
  return pageTitles[pathname] ?? "实验员工作台";
}

export function UserShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : "";
  const userInitial = user?.name?.charAt(0) || "用";

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  // 客户端挂载后才读取持久化的认证状态，避免 SSR hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // 客户端认证守卫：未登录则跳转登录页
  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/login");
    } else if (mounted && user?.platformRole === 'PLATFORM_ADMIN') {
      router.replace('/platform');
    } else if (mounted && user?.status && user.status !== 'ACTIVE') {
      router.replace('/application-status');
    }
  }, [mounted, isAuthenticated, user, router]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // 未挂载或未登录时不渲染内容，避免子组件发起无认证的 API 请求
  if (!mounted || !isAuthenticated || user?.platformRole === 'PLATFORM_ADMIN' || (user?.status && user.status !== 'ACTIVE')) {
    return (
      <div className="app-shell flex h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600" />
          <div className="text-sm text-slate-500">正在加载工作台…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-dvh overflow-hidden">
      {/* 桌面端侧边栏 */}
      <div className="hidden md:flex">
        <UserSidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      </div>

      {/* 移动端侧边栏 Drawer */}
      <Drawer
        visible={mobileOpen}
        onCancel={() => setMobileOpen(false)}
        placement="left"
        width={260}
        closable={false}
        footer={null}
        title={null}
        style={{ background: "#047857" }}
        bodyStyle={{ padding: 0, height: "100%" }}
        maskClosable
      >
        <UserSidebar collapsed={false} onToggle={closeMobile} mobile />
      </Drawer>

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="sticky top-0 z-40 isolate flex h-[68px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/85 px-3 shadow-sm shadow-slate-950/[0.025] backdrop-blur-xl sm:px-4 md:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {/* 移动端汉堡菜单 */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
              <span className="sr-only">打开菜单</span>
            </Button>

            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-800">
                {getPageTitle(pathname)}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <OnboardingLauncher />
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => router.push("/user/notifications")}
              aria-label="查看通知"
            >
              <Bell className="size-5 text-gray-400" />
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-orange-500 ring-2 ring-white" />
              <span className="sr-only">通知</span>
            </Button>

            <div className="hidden items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50 py-1.5 pl-1.5 pr-3 sm:flex">
              <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold text-white shadow-sm">
                {userInitial}
              </div>
              <span className="hidden text-sm font-medium text-gray-600 sm:inline">
                {roleLabel || "实验员"}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="退出登录">
              <LogOut className="size-4" />
              <span className="hidden lg:inline">退出登录</span>
            </Button>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="relative z-0 min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
          <div className="app-content" data-tour="page-content">{children}</div>
          {pathname === '/user' && <AuthorCredit />}
        </main>
      </div>

      {/* 悬浮智能助手 */}
      <FloatingChat />
      <OnboardingGuide role="member" />
    </div>
  );
}
