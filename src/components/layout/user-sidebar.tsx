"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  FileText,
  Cpu,
  Bell,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  Boxes,
  LibraryBig,
  FlaskRound,
  X,
} from "lucide-react";
import { Tooltip } from "@/arco-adapters/tooltip";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/store/auth-store";
import { ROLE_LABELS } from "@/types";

const navItems = [
  { label: "首页", href: "/user", icon: Home, color: "text-emerald-300" },
  { label: "我的申请", href: "/user/applications", icon: FileText, color: "text-teal-300" },
  { label: "设备预约", href: "/user/equipment-apply", icon: Cpu, color: "text-cyan-300" },
  { label: "安全巡检", href: "/user/inspections", icon: ClipboardCheck, color: "text-teal-300" },
  { label: "试剂库总览", href: "/user/alerts", icon: Boxes, color: "text-cyan-300" },
  { label: "我的通知", href: "/user/notifications", icon: Bell, color: "text-orange-300" },
  { label: "智能助手", href: "/user/assistant", icon: Bot, color: "text-violet-300" },
  { label: "化合物知识库", href: "/user/compounds", icon: FlaskRound, color: "text-pink-300" },
  { label: "课题知识库", href: "/user/knowledge", icon: LibraryBig, color: "text-amber-300" },
];

interface UserSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
}

export function UserSidebar({ collapsed, onToggle, mobile = false }: UserSidebarProps) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const roleLabel = user ? ROLE_LABELS[user.role] || user.role : "";
  const userInitial = user?.name?.charAt(0) || "用";

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col border-r border-white/10 bg-gradient-to-b from-[#0b4f4a] via-[#0b4542] to-[#083835] text-white shadow-xl shadow-slate-950/10 transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo 区域 */}
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 shadow-lg shadow-emerald-500/30">
          <Home className="size-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="truncate text-sm font-bold tracking-wide text-white">
              Lab Copilot
            </span>
            <span className="block text-[10px] font-medium text-emerald-300/80 tracking-widest">
              实验员工作台
            </span>
          </div>
        )}
      </div>

      <Separator className="mx-3 w-auto bg-white/10" />

      {/* 导航列表 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/user" && pathname.startsWith(item.href));

            const linkContent = (
              <Link
                href={item.href}
                data-tour={({
                  "/user/alerts": "member-reagents-nav",
                  "/user/equipment-apply": "member-equipment-nav",
                  "/user/assistant": "member-assistant-nav",
                  "/user/knowledge": "member-knowledge-nav",
                } as Record<string, string>)[item.href]}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-white/15 text-white shadow-lg shadow-black/10 backdrop-blur-sm"
                    : "text-emerald-200/80 hover:bg-white/8 hover:text-white",
                  collapsed && "justify-center px-0"
                )}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-white/20 shadow-inner"
                      : "bg-transparent group-hover:bg-white/10"
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
                  <span className={cn("truncate", isActive && "font-semibold")}>
                    {item.label}
                  </span>
                )}
                {isActive && !collapsed && (
                  <div className="ml-auto size-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
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
          })}
        </ul>
      </nav>

      <Separator className="mx-3 w-auto bg-white/10" />

      {/* 底部用户角色（点击跳转个人信息） */}
      <div className="px-3 py-3">
        {collapsed ? (
          <Tooltip content={roleLabel || "实验员"} position="right" mini>
            <Link href="/user/profile" className="flex justify-center">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold shadow-md shadow-emerald-500/20 transition-transform hover:scale-105">
                {userInitial}
              </div>
            </Link>
          </Tooltip>
        ) : (
          <Link
            href="/user/profile"
            className="group flex items-center gap-3 rounded-xl bg-white/8 px-3 py-2.5 backdrop-blur-sm transition-all hover:bg-white/15 cursor-pointer"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-bold shadow-md shadow-emerald-500/20 transition-transform group-hover:scale-105">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {user?.name || "实验员"}
              </p>
              <p className="truncate text-xs text-emerald-300/80">{roleLabel || "实验员"}</p>
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
            : "-right-3 top-8 size-6 border border-emerald-200 bg-white text-emerald-800 shadow-md hover:scale-110 hover:bg-emerald-50 hover:shadow-lg"
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
