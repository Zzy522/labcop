import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '账户访问',
  description: '登录或创建 Lab Copilot 账户，安全访问实验室工作台。',
};

/**
 * (auth) 路由组布局
 * 认证页面使用统一深色底座，并保留长表单的纵向滚动能力。
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-slate-950 text-slate-100">
      {children}
    </div>
  );
}
