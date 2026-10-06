"use client";

import { useState, useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Bell, LogOut, ChevronDown, Settings2 } from "lucide-react";
import { Drawer } from "@/arco-adapters/drawer";
import { Button } from "@/components/ui/button";
import { AdminSidebar } from "./admin-sidebar";
import { AuthorCredit } from '@/components/author-credit';
import { FloatingChat } from "@/components/assistant/floating-chat";
import { OnboardingGuide, OnboardingLauncher } from "@/components/onboarding/onboarding-guide";
import { useAuthStore } from "@/store/auth-store";
import { ROLE_LABELS, type UserRole } from "@/types";

const ADMIN_ROLES: UserRole[] = ["ADMIN"];

const pageTitles: Record<string, string> = {
  "/admin": "管理总览",
  "/admin/research": "科研总览",
  "/admin/reagents": "试剂总览",
  "/admin/equipment": "设备管理",
  "/admin/members": "成员管理",
  "/admin/members/applications": "新账号审批",
  "/admin/review": "审批中心",
  "/admin/announcements": "通告与预警",
  "/admin/inspections": "安全巡检",
  "/admin/qualifications": "人员资质",
  "/admin/reports": "报表中心",
  "/admin/rules": "规则配置",
  "/admin/assistant": "AI 助手",
  "/admin/knowledge": "课题知识库",
  "/admin/settings": "系统设置",
};

function getPageTitle(pathname: string): string {
  return pageTitles[pathname] ?? "管理员控制台";
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : "";
  const userInitial = user?.name?.charAt(0) || "管";

  const handleLogout = useCallback(() => {
    logout();
    router.push("/login");
  }, [logout, router]);

  // 客户端挂载后才读取持久化的认证状态，避免 SSR hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // 客户端认证守卫：未登录则跳转登录页，非管理员跳转到用户端
  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/login");
    } else if (mounted && user?.platformRole === 'PLATFORM_ADMIN') {
      router.replace('/platform');
    } else if (mounted && user?.status && user.status !== 'ACTIVE') {
      router.replace('/application-status');
    } else if (mounted && isAuthenticated && user && !ADMIN_ROLES.includes(user.role)) {
      router.replace("/user");
    }
  }, [mounted, isAuthenticated, user, router]);

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-user-menu]")) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userMenuOpen]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // 未挂载、未登录或非管理员时不渲染内容
  if (!mounted || !isAuthenticated || !user || user.platformRole === 'PLATFORM_ADMIN' || (user.status && user.status !== 'ACTIVE') || !ADMIN_ROLES.includes(user.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          <div className="text-sm text-gray-400">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-dvh overflow-hidden">
      {/* 桌面端侧边栏 */}
      <div className="hidden md:flex">
        <AdminSidebar collapsed={collapsed} onToggle={toggleCollapsed} />
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
        style={{ background: "#0c4a6e" }}
        bodyStyle={{ padding: 0, height: "100%" }}
        maskClosable
      >
        <AdminSidebar collapsed={false} onToggle={closeMobile} mobile />
      </Drawer>

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部标题栏 */}
        <header className="sticky top-0 z-40 isolate flex h-[68px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/85 px-3 shadow-sm shadow-slate-950/[0.025] backdrop-blur-xl sm:px-4 md:px-6 lg:px-8">
          {/* 左侧：标题 */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
              <span className="sr-only">打开菜单</span>
            </Button>

            <div>
              <h1 className="text-base font-semibold leading-tight text-gray-800">
                {getPageTitle(pathname)}
              </h1>
            </div>
          </div>

          {/* 右侧：通知 + 用户菜单 */}
          <div className="flex items-center gap-1.5">
            <OnboardingLauncher />
            {/* 通知铃铛 */}
            <Button
              variant="ghost"
              size="icon"
              className="relative hover:bg-blue-50"
              onClick={() => router.push("/admin")}
              aria-label="查看系统提醒"
            >
              <Bell className="size-5 text-gray-500" />
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-orange-500 ring-2 ring-white" />
              <span className="sr-only">通知</span>
            </Button>

            {/* 用户菜单 */}
            <div className="relative" data-user-menu>
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-xl bg-gray-50 py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-gray-100"
              >
                <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white shadow-sm">
                  {userInitial}
                </div>
                <span className="hidden text-sm font-medium text-gray-700 sm:inline">
                  {user.name || roleLabel || "管理员"}
                </span>
                <ChevronDown className="size-3.5 text-gray-400 transition-transform" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none' }} />
              </button>

              {/* 下拉菜单 */}
              {userMenuOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
                  <div className="border-b border-gray-50 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-gray-800">{user.name || "管理员"}</p>
                    <p className="truncate text-xs text-gray-400">{roleLabel || "系统管理员"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      router.push("/admin/settings");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <Settings2 className="size-4" />
                    系统设置
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <LogOut className="size-4" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
          <div className="app-content" data-tour="page-content">{children}</div>
          {pathname === '/admin' && <AuthorCredit />}
        </main>
      </div>

      {/* 管理员端智能体管理助理（与实验员端 UI 一致，权限和提示词隔离）*/}
      <FloatingChat role="admin" />
      <OnboardingGuide role="admin" />
    </div>
  );
}
