import type { Metadata } from "next";
import "@arco-design/web-react/dist/css/arco.css";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { ToastContainer } from "@/components/ui/toast";
import { MaintenanceMonitor } from "@/components/maintenance-monitor";
import { AuthSessionProvider } from '@/components/providers/auth-session-provider';

export const metadata: Metadata = {
  title: {
    default: "Lab Copilot · 实验室安全管理",
    template: "%s | Lab Copilot",
  },
  description: "面向实验室试剂、设备、审批与安全巡检的一体化智能管理平台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col font-sans selection:bg-teal-200 selection:text-teal-950">
        <QueryProvider>
          <MaintenanceMonitor />
          <AuthSessionProvider>{children}</AuthSessionProvider>
          <ToastContainer />
        </QueryProvider>
      </body>
    </html>
  );
}
