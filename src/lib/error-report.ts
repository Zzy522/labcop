/**
 * 错误上报模块
 *
 * 设计目标：
 * - 客户端：通过 navigator.sendBeacon 异步上报到 /api/error-report
 * - 服务端：通过 console.error 输出结构化日志（生产可对接日志服务）
 * - 采样策略：避免高频错误刷爆上报接口
 * - 脱敏：不收集用户敏感信息（API Key、密码等）
 *
 * 使用方式：
 *   import { reportError } from '@/lib/error-report';
 *   try { ... } catch (err) {
 *     reportError(err, { tag: 'reagent-upload', extra: { fileName } });
 *   }
 *
 * 注意：本模块不阻塞主流程，上报失败静默忽略
 */

import { AppError, ErrorCategory, toAppError } from './errors';

/** 上报负载（脱敏后） */
export interface ErrorReportPayload {
  /** 错误大类 */
  category: ErrorCategory | 'UNKNOWN';
  /** 错误消息（截断到 500 字符） */
  message: string;
  /** 错误堆栈（仅客户端，截断到 2000 字符） */
  stack?: string;
  /** 错误发生位置标签（如 'reagent-upload'） */
  tag?: string;
  /** 附加上下文（调用方提供，原样上报） */
  extra?: Record<string, unknown>;
  /** 时间戳 ISO 字符串 */
  timestamp: string;
  /** 运行环境 */
  environment: 'client' | 'server';
  /** 页面 URL（仅客户端） */
  url?: string;
  /** 用户角色（脱敏：仅 role，不含 id/email） */
  userRole?: string;
  /** HTTP 状态码（AppError） */
  httpStatus?: number;
  /** requestId（来自服务端 withErrorHandler） */
  requestId?: string;
  /** AppError.context 字段（已脱敏，仅含调用方显式放入的字段） */
  context?: Record<string, unknown>;
  /** 会话 ID（同一用户多次上报可关联，但不含身份信息） */
  sessionId: string;
}

// ─── 采样控制 ───

/** 同一 message 在 1 分钟内只上报 1 次（避免循环错误刷屏） */
const REPORT_DEDUP_WINDOW_MS = 60_000;
const recentReports = new Map<string, number>();

/** 单次会话最多上报 50 条错误（避免内存膨胀） */
const MAX_REPORTS_PER_SESSION = 50;
let reportCount = 0;

// ─── 会话 ID（匿名，每次页面刷新变化）───

let sessionId = '';
function getSessionId(): string {
  if (!sessionId) {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        'lab_error_session_id',
        sessionStorage.getItem('lab_error_session_id') ||
          `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      sessionId = sessionStorage.getItem('lab_error_session_id') || '';
    } else {
      sessionId = `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }
  return sessionId;
}

// ─── 主上报函数 ───

/**
 * 上报错误（不抛出，不阻塞）
 *
 * @param error 任意错误对象
 * @param options 上报选项
 *   - tag: 错误位置标签
 *   - extra: 附加上下文
 *   - force: 跳过采样限制（默认 false）
 */
export function reportError(
  error: unknown,
  options: { tag?: string; extra?: Record<string, unknown>; force?: boolean } = {}
): void {
  try {
    // 采样限制
    if (reportCount >= MAX_REPORTS_PER_SESSION && !options.force) {
      return;
    }

    const appError = toAppError(error);
    const dedupKey = `${appError.category}:${appError.message.slice(0, 100)}`;
    const now = Date.now();
    const lastReportedAt = recentReports.get(dedupKey);
    if (lastReportedAt && now - lastReportedAt < REPORT_DEDUP_WINDOW_MS && !options.force) {
      return; // 1 分钟内已上报过相同错误
    }
    recentReports.set(dedupKey, now);

    // 清理过期 dedup 记录（避免 Map 膨胀）
    if (recentReports.size > 100) {
      for (const [key, ts] of recentReports) {
        if (now - ts > REPORT_DEDUP_WINDOW_MS) recentReports.delete(key);
      }
    }

    reportCount++;

    const isClient = typeof window !== 'undefined';
    const payload: ErrorReportPayload = {
      category: appError.category,
      message: appError.message.slice(0, 500),
      stack: appError.stack?.slice(0, 2000),
      tag: options.tag,
      extra: options.extra,
      timestamp: new Date().toISOString(),
      environment: isClient ? 'client' : 'server',
      url: isClient ? window.location.href : undefined,
      userRole: getUserRoleSafely(),
      httpStatus: appError.httpStatus,
      requestId: appError.options.context?.requestId as string | undefined,
      context: appError.options.context,
      sessionId: getSessionId(),
    };

    if (isClient) {
      reportFromClient(payload);
    } else {
      reportFromServer(payload);
    }
  } catch {
    // 上报本身失败不影响主流程
  }
}

/** 客户端上报：用 sendBeacon 异步发送（不阻塞页面卸载） */
function reportFromClient(payload: ErrorReportPayload): void {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
    // 降级：用 fetch（不 await）
    void fetch('/api/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
    return;
  }
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    navigator.sendBeacon('/api/error-report', blob);
  } catch {
    // sendBeacon 失败时降级 fetch
    void fetch('/api/error-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
}

/** 服务端上报：结构化日志输出（生产环境可对接 ELK/Loki） */
function reportFromServer(payload: ErrorReportPayload): void {
  // eslint-disable-next-line no-console
  console.error('[ErrorReport]', JSON.stringify(payload));
}

/** 安全获取用户角色（脱敏：不含 userId） */
function getUserRoleSafely(): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    // 从 localStorage 获取（auth-store 持久化）
    const stored = localStorage.getItem('lab-auth-storage');
    if (!stored) return undefined;
    const parsed = JSON.parse(stored);
    return parsed?.state?.user?.role;
  } catch {
    return undefined;
  }
}

// ─── 全局错误捕获：自动上报未 catch 的错误 ───

let globalHandlersInstalled = false;

/**
 * 安装全局错误捕获
 * 在 RootLayout 客户端组件中调用一次，自动捕获：
 * - window.onerror：同步错误
 * - window.onunhandledrejection：未处理的 Promise rejection
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === 'undefined') return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, {
      tag: 'global.error',
      extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { tag: 'global.unhandledrejection' });
  });
}
