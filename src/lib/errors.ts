/**
 * 统一错误码体系
 *
 * 设计目标：
 * 1. 替代散落在各处的字符串匹配（message.includes('尚未配置')）
 * 2. 为前端提供结构化错误信息（category + actionUrl + retryable）
 * 3. 为重试机制提供判断依据（retryable 字段）
 * 4. 为错误上报提供分类维度
 *
 * 使用方式：
 *   throw new AppError(ErrorCategory.CONFIG_MISSING, '尚未配置 Token', {
 *     actionUrl: '/user/api-config',
 *     actionText: '前往配置'
 *   });
 */

/** 错误大类：用于前端展示和重试策略判断 */
export enum ErrorCategory {
  /** 配置缺失：API Key/Token 未配置，需引导用户去配置页 */
  CONFIG_MISSING = 'CONFIG_MISSING',
  /** 认证失败：API Key 无效或过期（HTTP 401） */
  AUTH_INVALID = 'AUTH_INVALID',
  /** 额度/限流：API 额度不足或频率超限（HTTP 402/429） */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** 上游服务错误：第三方 API 5xx（LLM/OCR/PubChem） */
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  /** 网络异常：fetch 抛出 TypeError、DNS 失败、超时 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 解析失败：LLM JSON 解析失败、OCR 结果提取失败 */
  PARSE_ERROR = 'PARSE_ERROR',
  /** 输入校验失败：文件类型/大小不符、Zod 校验失败 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** 资源不存在 */
  NOT_FOUND = 'NOT_FOUND',
  /** 权限不足：角色越权、跨实验室访问 */
  FORBIDDEN = 'FORBIDDEN',
  /** 业务规则冲突：预约时间重叠、库存不足等 */
  BUSINESS_CONFLICT = 'BUSINESS_CONFLICT',
  /** 兜底：未分类的内部错误 */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** HTTP 状态码 → ErrorCategory 默认映射（用于从第三方响应推断分类） */
export const HTTP_STATUS_TO_CATEGORY: Record<number, ErrorCategory> = {
  400: ErrorCategory.VALIDATION_ERROR,
  401: ErrorCategory.AUTH_INVALID,
  402: ErrorCategory.QUOTA_EXCEEDED,
  403: ErrorCategory.FORBIDDEN,
  404: ErrorCategory.NOT_FOUND,
  409: ErrorCategory.BUSINESS_CONFLICT,
  422: ErrorCategory.VALIDATION_ERROR,
  429: ErrorCategory.QUOTA_EXCEEDED,
};

export interface AppErrorOptions {
  /** HTTP 响应状态码（默认 500） */
  httpStatus?: number;
  /** 引导用户跳转的 URL（如 /user/api-config） */
  actionUrl?: string;
  /** 跳转按钮文案 */
  actionText?: string;
  /** 是否可重试（默认 false；网络错误/上游 5xx 默认 true） */
  retryable?: boolean;
  /** 原始错误（保留链路，便于排查） */
  cause?: unknown;
  /** 附加上下文（用于错误上报，不会返回给前端） */
  context?: Record<string, unknown>;
}

/**
 * 应用统一错误类
 *
 * 所有业务代码应抛出 AppError 而非原生 Error，
 * 以便 withErrorHandler 统一处理、前端统一展示、重试机制统一判断。
 */
export class AppError extends Error {
  public readonly category: ErrorCategory;
  public readonly options: AppErrorOptions;

  constructor(category: ErrorCategory, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.category = category;
    this.options = options;

    // 保留原始错误链（V8 引擎支持 Error.cause）
    if (options.cause instanceof Error && !('cause' in this)) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  /** 是否可重试（显式配置优先，否则按 category 默认值） */
  get isRetryable(): boolean {
    if (this.options.retryable !== undefined) return this.options.retryable;
    return DEFAULT_RETRYABLE_CATEGORIES.has(this.category);
  }

  /** 推荐的 HTTP 状态码 */
  get httpStatus(): number {
    return this.options.httpStatus ?? CATEGORY_DEFAULT_HTTP_STATUS[this.category] ?? 500;
  }

  /** 序列化为前端可用的 JSON 结构（脱敏，不含 context/cause） */
  toJSON() {
    return {
      error: this.message,
      category: this.category,
      httpStatus: this.httpStatus,
      retryable: this.isRetryable,
      actionUrl: this.options.actionUrl,
      actionText: this.options.actionText,
    };
  }
}

/** 默认可重试的错误类别 */
export const DEFAULT_RETRYABLE_CATEGORIES = new Set<ErrorCategory>([
  ErrorCategory.NETWORK_ERROR,
  ErrorCategory.UPSTREAM_ERROR,
  ErrorCategory.QUOTA_EXCEEDED, // 限流可重试（配合退避）
]);

/** 错误类别 → 默认 HTTP 状态码 */
export const CATEGORY_DEFAULT_HTTP_STATUS: Record<ErrorCategory, number> = {
  [ErrorCategory.CONFIG_MISSING]: 400,
  [ErrorCategory.AUTH_INVALID]: 401,
  [ErrorCategory.QUOTA_EXCEEDED]: 429,
  [ErrorCategory.UPSTREAM_ERROR]: 502,
  [ErrorCategory.NETWORK_ERROR]: 502,
  [ErrorCategory.PARSE_ERROR]: 502,
  [ErrorCategory.VALIDATION_ERROR]: 400,
  [ErrorCategory.NOT_FOUND]: 404,
  [ErrorCategory.FORBIDDEN]: 403,
  [ErrorCategory.BUSINESS_CONFLICT]: 409,
  [ErrorCategory.INTERNAL_ERROR]: 500,
};

// ─── 便捷工厂函数：常见场景一行创建 ───

export const Errors = {
  configMissing: (message: string, actionUrl?: string, actionText?: string) =>
    new AppError(ErrorCategory.CONFIG_MISSING, message, { actionUrl, actionText }),

  authInvalid: (message = 'API Key 无效或已过期', actionUrl?: string) =>
    new AppError(ErrorCategory.AUTH_INVALID, message, { actionUrl }),

  quotaExceeded: (message = 'API 额度不足或请求频率超限') =>
    new AppError(ErrorCategory.QUOTA_EXCEEDED, message, { retryable: true }),

  upstreamError: (message: string, service?: string) =>
    new AppError(ErrorCategory.UPSTREAM_ERROR, message, {
      context: { service },
    }),

  networkError: (reason: string, service?: string) =>
    new AppError(ErrorCategory.NETWORK_ERROR, `${service ? `[${service}] ` : ''}网络异常：${reason}`, {
      context: { service, reason },
    }),

  parseError: (message: string, rawContent?: string) =>
    new AppError(ErrorCategory.PARSE_ERROR, message, {
      context: { rawContentLength: rawContent?.length, rawContentPreview: rawContent?.slice(0, 300) },
    }),

  validationError: (message: string, details?: Record<string, string[]>) =>
    new AppError(ErrorCategory.VALIDATION_ERROR, message, { context: { details } }),

  notFound: (entity = '资源') => new AppError(ErrorCategory.NOT_FOUND, `${entity}不存在`),

  forbidden: (message = '权限不足') => new AppError(ErrorCategory.FORBIDDEN, message),

  businessConflict: (message: string) => new AppError(ErrorCategory.BUSINESS_CONFLICT, message),

  internal: (message = '服务器内部错误', cause?: unknown) =>
    new AppError(ErrorCategory.INTERNAL_ERROR, message, { cause }),
};

/**
 * 从未知错误中提取 AppError（非 AppError 自动包装为 internal）
 * 用于 withErrorHandler 的兜底处理
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return Errors.internal(error.message, error);
  }
  return Errors.internal(String(error));
}

/**
 * 根据 HTTP 状态码推断错误类别（用于第三方 API 响应）
 */
export function inferCategoryFromHttpStatus(status: number): ErrorCategory {
  if (status >= 500) return ErrorCategory.UPSTREAM_ERROR;
  return HTTP_STATUS_TO_CATEGORY[status] ?? ErrorCategory.UPSTREAM_ERROR;
}
