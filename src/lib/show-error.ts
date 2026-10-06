'use client';

/**
 * 统一错误展示工具
 *
 * 设计目标：
 * - 把 AppError / 未知错误统一转成 Toast 提示
 * - 按 category 决定提示风格、持续时间、是否带操作按钮
 * - 配合 auth-fetch.ts 的 AppError 抛出，前端代码只需 try/catch + showErrorToast
 *
 * 使用方式：
 *   import { showErrorToast } from '@/lib/show-error';
 *   try {
 *     await authFetchJSON('/api/...');
 *   } catch (err) {
 *     showErrorToast(err);
 *   }
 */

import { toast, type ToastVariant } from '@/components/ui/toast';
import { AppError, ErrorCategory, toAppError } from '@/lib/errors';

/** 各 category 对应的 Toast 风格和默认行为 */
const CATEGORY_TOAST_CONFIG: Record<
  ErrorCategory,
  { variant: ToastVariant; duration: number }
> = {
  // 配置缺失：醒目提示 + 长时间 + 跳转按钮（来自 actionUrl）
  [ErrorCategory.CONFIG_MISSING]: { variant: 'warning', duration: 10000 },
  // 认证失败：错误提示 + 跳转按钮
  [ErrorCategory.AUTH_INVALID]: { variant: 'error', duration: 10000 },
  // 额度/限流：警告 + 短时
  [ErrorCategory.QUOTA_EXCEEDED]: { variant: 'warning', duration: 6000 },
  // 上游服务错误：错误 + 短时
  [ErrorCategory.UPSTREAM_ERROR]: { variant: 'error', duration: 6000 },
  // 网络异常：错误 + 短时（重试机制会先尝试）
  [ErrorCategory.NETWORK_ERROR]: { variant: 'error', duration: 6000 },
  // 解析失败：错误 + 中等时长
  [ErrorCategory.PARSE_ERROR]: { variant: 'error', duration: 7000 },
  // 输入校验：警告 + 短时
  [ErrorCategory.VALIDATION_ERROR]: { variant: 'warning', duration: 5000 },
  // 资源不存在：信息 + 短时
  [ErrorCategory.NOT_FOUND]: { variant: 'info', duration: 4000 },
  // 权限不足：错误 + 短时
  [ErrorCategory.FORBIDDEN]: { variant: 'error', duration: 5000 },
  // 业务冲突：警告 + 短时
  [ErrorCategory.BUSINESS_CONFLICT]: { variant: 'warning', duration: 5000 },
  // 内部错误：错误 + 长 + requestId
  [ErrorCategory.INTERNAL_ERROR]: { variant: 'error', duration: 10000 },
};

/**
 * 展示错误 Toast
 *
 * @param error 任意错误（AppError / Error / string）
 * @param options 覆盖默认行为
 *   - skipAction: 不展示跳转按钮（用于已内联处理的场景）
 *   - prefix: 在消息前追加文案（如 "保存失败："）
 */
export function showErrorToast(
  error: unknown,
  options: { skipAction?: boolean; prefix?: string } = {}
) {
  const appError = toAppError(error);
  const config = CATEGORY_TOAST_CONFIG[appError.category] ?? {
    variant: 'error' as ToastVariant,
    duration: 5000,
  };

  let message = appError.message;
  if (options.prefix) {
    message = `${options.prefix}${message}`;
  }

  // 内部错误附带 requestId 便于客服定位
  if (appError.category === ErrorCategory.INTERNAL_ERROR) {
    const requestId = appError.options.context?.requestId as string | undefined;
    if (requestId) {
      message = `${message}\n\n追踪号：${requestId}`;
    }
  }

  // 构造操作按钮（从 actionUrl/actionText）
  let action: { label: string; onClick: () => void } | undefined;
  if (!options.skipAction && appError.options.actionUrl) {
    action = {
      label: appError.options.actionText || '前往处理',
      onClick: () => {
        // 用 window.location.href 跳转，避免依赖 Next router（工具函数无 hook 上下文）
        window.location.href = appError.options.actionUrl!;
      },
    };
  }

  toast[config.variant](message, {
    duration: config.duration,
    action,
  });

  // 同时输出到控制台，便于开发调试
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.error('[showErrorToast]', {
      category: appError.category,
      message: appError.message,
      context: appError.options.context,
      stack: appError.stack,
    });
  }
}

/**
 * 展示成功 Toast（便捷封装）
 */
export function showSuccessToast(message: string) {
  toast.success(message);
}

/**
 * 展示信息 Toast（便捷封装）
 */
export function showInfoToast(message: string) {
  toast.info(message);
}
