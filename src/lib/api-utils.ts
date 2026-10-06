import { NextRequest, NextResponse } from 'next/server';
import { AppError, Errors, toAppError } from './errors';

// ─── 统一分页参数解析 ───
export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize = 20,
  maxPageSize = 100
): PaginationParams {
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.max(1, Math.min(maxPageSize, Number(searchParams.get('pageSize')) || defaultPageSize));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

// ─── 统一分页响应 ───
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ─── 统一错误响应 ───
export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function notFoundError(entity = '资源') {
  return apiError(`${entity}不存在`, 404);
}

export function validationError(details: string | Record<string, string[]>) {
  return NextResponse.json(
    { error: '输入校验失败', details },
    { status: 400 }
  );
}

// ─── 统一实体存在性检查 ───
export async function requireEntity<T>(
  query: Promise<T | null>,
  entityName = '资源'
): Promise<T> {
  const result = await query;
  if (!result) {
    throw new NotFoundError(entityName);
  }
  return result;
}

// ─── 自定义错误类（继承 AppError，统一纳入错误码体系）───
import { ErrorCategory } from './errors';

export class NotFoundError extends AppError {
  constructor(entityName: string) {
    super(ErrorCategory.NOT_FOUND, `${entityName}不存在`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  details?: Record<string, string[]>;
  constructor(message: string, details?: Record<string, string[]>) {
    super(ErrorCategory.VALIDATION_ERROR, message, { context: { details } });
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * 生成 requestId（用于错误追踪）
 * 优先用 crypto.randomUUID（Node 18+/浏览器原生），否则降级
 */
function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ─── API 路由统一错误处理包装器 ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandler<T extends any[]>(
  handler: (...args: T) => Promise<NextResponse>
): (...args: T) => Promise<NextResponse> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      const appError = toAppError(error);
      const requestId = generateRequestId();

      // 服务端日志：含完整堆栈和 context，便于排查
      console.error(`[API Error][${requestId}]`, {
        category: appError.category,
        message: appError.message,
        httpStatus: appError.httpStatus,
        retryable: appError.isRetryable,
        context: appError.options.context,
        stack: appError instanceof Error ? appError.stack : undefined,
        cause: appError.options.cause,
      });

      // 前端响应：脱敏，不含 context/cause/stack
      // - AppError 用结构化 JSON 输出
      // - 内部错误额外附带 requestId 便于客服定位
      const body: Record<string, unknown> = {
        error: appError.message,
        category: appError.category,
        retryable: appError.isRetryable,
      };

      if (appError.options.actionUrl) {
        body.actionUrl = appError.options.actionUrl;
        body.actionText = appError.options.actionText || '前往处理';
      }

      // 内部错误附带 requestId（其他类型也可附带，便于全链路追踪）
      if (appError.category === ErrorCategory.INTERNAL_ERROR) {
        body.requestId = requestId;
      }

      return NextResponse.json(body, { status: appError.httpStatus });
    }
  };
}

// ─── 通用查询条件构建 ───
export function buildWhereClause(
  searchParams: URLSearchParams,
  fieldMap: Record<string, { field: string; type?: 'string' | 'number' | 'boolean' }>
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const [paramKey, config] of Object.entries(fieldMap)) {
    const value = searchParams.get(paramKey);
    if (!value) continue;
    if (config.type === 'boolean') {
      where[config.field] = value === 'true';
    } else if (config.type === 'number') {
      where[config.field] = Number(value);
    } else {
      where[config.field] = value;
    }
  }
  return where;
}
