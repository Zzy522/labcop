export function AuthorCredit({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={`mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-3 text-center text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`} aria-label="开发者信息">
      <span>Lab Copilot · 开发者</span>
      <a href="https://github.com/Zzy522" target="_blank" rel="noopener noreferrer" className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Zzy522 / GitHub</a>
      <span>微信：jingzbdcjl</span>
      <a href="https://github.com/Zzy522/labcop" target="_blank" rel="noopener noreferrer" className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">AGPLv3 · 源码</a>
    </footer>
  );
}
