"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FlaskConical,
  Cpu,
  ShieldCheck,
  ClipboardCheck,
  Award,
  BarChart3,
  Settings2,
  Bot,
  Megaphone,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  LibraryBig,
  FlaskRound,
  FolderCog,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { Tooltip } from "@/arco-adapters/tooltip";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/store/auth-store";
import { ROLE_LABELS } from "@/types";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  color: string;
}

const topItems: NavItem[] = [
  { label: "科研总览", href: "/admin/research", icon: Sparkles, color: "text-violet-300" },
  { label: "管理总览", href: "/admin", icon: LayoutDashboard, color: "text-blue-300" },
  { label: "试剂总览", href: "/admin/reagents", icon: FlaskConical, color: "text-cyan-300" },
];

/** 「管理相关」分组：低频管理入口折叠收纳，点击后展开 */
const mgmtGroup: { label: string; icon: React.ElementType; color: string; children: NavItem[] } = {
  label: "管理相关",
  icon: FolderCog,
  color: "text-orange-300",
  children: [
    { label: "设备管理", href: "/admin/equipment", icon: Cpu, color: "text-indigo-300" },
    { label: "成员管理", href: "/admin/members", icon: UserPlus, color: "text-blue-300" },
    { label: "账号申请", href: "/admin/members/applications", icon: ShieldCheck, color: "text-teal-300" },
    { label: "审批中心", href: "/admin/review", icon: ShieldCheck, color: "text-emerald-300" },
    { label: "安全巡检", href: "/admin/inspections", icon: ClipboardCheck, color: "text-teal-300" },
    { label: "人员资质", href: "/admin/qualifications", icon: Award, color: "text-fuchsia-300" },
    { label: "报表中心", href: "/admin/reports", icon: BarChart3, color: "text-sky-300" },
    { label: "规则配置", href: "/admin/rules", icon: Settings2, color: "text-violet-300" },
  ],
};

const bottomItems: NavItem[] = [
  { label: "通告与预警", href: "/admin/announcements", icon: Megaphone, color: "text-cyan-300" },
  { label: "化合物知识库", href: "/admin/compounds", icon: FlaskRound, color: "text-pink-300" },
  { label: "课题知识库", href: "/admin/knowledge", icon: LibraryBig, color: "text-amber-300" },
  { label: "AI 助手", href: "/admin/assistant", icon: Bot, color: "text-violet-300" },
];

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
}

export function AdminSidebar({ collapsed, onToggle, mobile = false }: AdminSidebarProps) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : "";
  const userInitial = user?.name?.charAt(0) || "管";

  const isItemActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname.startsWith(href));

  const mgmtActive = mgmtGroup.children.some((c) => isItemActive(c.href));
  const [mgmtOpen, setMgmtOpen] = useState(mgmtActive);

  // 路由进入分组内页面时自动展开
  useEffect(() => {
    if (mgmtActive) setMgmtOpen(true);
  }, [mgmtActive]);

  // ─── 普通导航项 ───
  const renderNavItem = (item: NavItem) => {
    const isActive = isItemActive(item.href);
    const tourId: Record<string, string> = {
      "/admin/research": "admin-research-nav",
      "/admin/reagents": "admin-reagents-nav",
      "/admin/assistant": "admin-assistant-nav",
      "/admin/knowledge": "admin-knowledge-nav",
    };

    const linkContent = (
      <Link
        href={item.href}
        data-tour={tourId[item.href]}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-white/15 text-white shadow-lg shadow-black/10 backdrop-blur-sm"
            : "text-sky-200/80 hover:bg-white/8 hover:text-white",
          collapsed && "justify-center px-0"
        )}
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
            isActive ? "bg-white/20 shadow-inner" : "bg-transparent group-hover:bg-white/10"
          )}
        >
          <item.icon
            className={cn(
              "size-[18px] transition-colors duration-200",
              isActive ? "text-white" : item.color
            )}
          />
        </div>
        {!collapsed && (
          <span className={cn("truncate", isActive && "font-semibold")}>{item.label}</span>
        )}
        {isActive && !collapsed && (
          <div className="ml-auto size-1.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <li key={item.href}>
          <Tooltip content={item.label} position="right" mini>
            {linkContent}
          </Tooltip>
        </li>
      );
    }
    return <li key={item.href}>{linkContent}</li>;
  };

  // ─── 分组子项（缩进样式） ───
  const renderSubItem = (item: NavItem) => {
    const isActive = isItemActive(item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={cn(
            "group flex items-center gap-3 rounded-xl py-2 pl-6 pr-3 text-[13px] font-medium transition-all duration-200",
            isActive
              ? "bg-white/15 text-white shadow-md shadow-black/10"
              : "text-sky-200/70 hover:bg-white/8 hover:text-white"
          )}
        >
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
              isActive ? "bg-white/20 shadow-inner" : "bg-transparent group-hover:bg-white/10"
            )}
          >
            <item.icon
              className={cn(
                "size-4 transition-colors duration-200",
                isActive ? "text-white" : item.color
              )}
            />
          </div>
          <span className={cn("truncate", isActive && "font-semibold")}>{item.label}</span>
          {isActive && (
            <div className="ml-auto size-1.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
          )}
        </Link>
      </li>
    );
  };

  // ─── 「管理相关」分组 ───
  const renderMgmtGroup = () => {
    // 折叠模式：平铺子项为图标入口（带 Tooltip）
    if (collapsed) {
      return <>{mgmtGroup.children.map((item) => renderNavItem(item))}</>;
    }

    return (
      <li>
        <button
          type="button"
          data-tour="admin-management-group"
          onClick={() => setMgmtOpen((v) => !v)}
          aria-expanded={mgmtOpen}
          className={cn(
            "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
            mgmtActive
              ? "bg-white/10 text-white"
              : "text-sky-200/80 hover:bg-white/8 hover:text-white"
          )}
        >
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
              mgmtActive ? "bg-white/15" : "bg-transparent group-hover:bg-white/10"
            )}
          >
            <mgmtGroup.icon
              className={cn(
                "size-[18px] transition-colors duration-200",
                mgmtActive ? "text-white" : mgmtGroup.color
              )}
            />
          </div>
          <span className={cn("truncate", mgmtActive && "font-semibold")}>
            {mgmtGroup.label}
          </span>
          {mgmtActive && !mgmtOpen && (
            <div className="ml-auto size-1.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
          )}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-sky-300/70 transition-transform duration-300",
              mgmtActive && !mgmtOpen ? "" : "ml-auto",
              mgmtOpen && "rotate-180"
            )}
          />
        </button>

        {/* 展开动画：grid-rows 0fr → 1fr */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            mgmtOpen ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-hidden border-l border-white/10 ml-7 pl-2">
            {mgmtGroup.children.map((item) => renderSubItem(item))}
          </ul>
        </div>
      </li>
    );
  };

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col border-r border-white/10 bg-gradient-to-b from-[#123f54] via-[#0e3549] to-[#0a2939] text-white shadow-xl shadow-slate-950/10 transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo 区域 */}
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg shadow-blue-500/30">
          <ShieldCheck className="size-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="truncate text-sm font-bold tracking-wide text-white">
              Lab Copilot
            </span>
            <span className="block text-[10px] font-medium text-blue-300/80 tracking-widest">
              管理控制台
            </span>
          </div>
        )}
      </div>

      <Separator className="mx-3 w-auto bg-white/10" />

      {/* 导航列表 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1.5">
          {topItems.map((item) => renderNavItem(item))}
          {renderMgmtGroup()}
          {bottomItems.map((item) => renderNavItem(item))}
        </ul>
      </nav>

      <Separator className="mx-3 w-auto bg-white/10" />

      {/* 底部用户角色（点击跳转个人设置） */}
      <div className="px-3 py-3">
        {collapsed ? (
          <Tooltip content={roleLabel || "管理员"} position="right" mini>
            <Link href="/admin/settings" className="flex justify-center">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold shadow-md shadow-blue-500/20 transition-transform hover:scale-105">
                {userInitial}
              </div>
            </Link>
          </Tooltip>
        ) : (
          <Link
            href="/admin/settings"
            className="group flex items-center gap-3 rounded-xl bg-white/8 px-3 py-2.5 backdrop-blur-sm transition-all hover:bg-white/15 cursor-pointer"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold shadow-md shadow-blue-500/20 transition-transform group-hover:scale-105">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {user?.name || "管理员"}
              </p>
              <p className="truncate text-xs text-blue-300/80">{roleLabel || "系统管理员"}</p>
            </div>
          </Link>
        )}
      </div>

      {/* 折叠按钮 */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={mobile ? "关闭菜单" : collapsed ? "展开侧边栏" : "收起侧边栏"}
        className={cn(
          "absolute flex items-center justify-center rounded-full transition-all duration-200",
          mobile
            ? "right-3 top-5 size-8 border border-white/15 bg-white/10 text-white hover:bg-white/20"
            : "-right-3 top-8 size-6 border border-blue-200 bg-white text-blue-800 shadow-md hover:scale-110 hover:bg-blue-50 hover:shadow-lg"
        )}
      >
        {mobile ? (
          <X className="size-4" />
        ) : collapsed ? (
          <ChevronsRight className="size-3.5" />
        ) : (
          <ChevronsLeft className="size-3.5" />
        )}
      </button>
    </aside>
  );
}
