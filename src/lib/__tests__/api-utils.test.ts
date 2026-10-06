import { describe, it, expect } from 'vitest';
import { parsePagination, paginatedResponse, NotFoundError, ValidationError } from '../api-utils';

describe('parsePagination', () => {
  it('默认分页参数', () => {
    const params = new URLSearchParams();
    const result = parsePagination(params);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.skip).toBe(0);
  });

  it('自定义分页参数', () => {
    const params = new URLSearchParams('page=3&pageSize=50');
    const result = parsePagination(params);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
    expect(result.skip).toBe(100);
  });

  it('page 不能小于 1', () => {
    const params = new URLSearchParams('page=0');
    const result = parsePagination(params);
    expect(result.page).toBe(1);
  });

  it('pageSize 不能超过 maxPageSize', () => {
    const params = new URLSearchParams('pageSize=200');
    const result = parsePagination(params, 20, 100);
    expect(result.pageSize).toBe(100);
  });

  it('非数字参数使用默认值', () => {
    const params = new URLSearchParams('page=abc&pageSize=xyz');
    const result = parsePagination(params);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });
});

describe('paginatedResponse', () => {
  it('正确计算 totalPages', () => {
    const result = paginatedResponse([1, 2, 3], 25, 1, 20);
    expect(result.pagination.totalPages).toBe(2);
  });

  it('总数为0时 totalPages 为 0', () => {
    const result = paginatedResponse([], 0, 1, 20);
    expect(result.pagination.totalPages).toBe(0);
  });
});

describe('NotFoundError', () => {
  it('应包含正确的错误信息和状态码', () => {
    const error = new NotFoundError('试剂');
    expect(error.message).toBe('试剂不存在');
    // AppError 使用 httpStatus getter（非旧版 status 字段）
    expect(error.httpStatus).toBe(404);
    expect(error.name).toBe('NotFoundError');
    expect(error.category).toBe('NOT_FOUND');
  });
});

describe('ValidationError', () => {
  it('应包含正确的错误信息和状态码', () => {
    const error = new ValidationError('校验失败', { name: ['不能为空'] });
    expect(error.message).toBe('校验失败');
    // AppError 使用 httpStatus getter（非旧版 status 字段）
    expect(error.httpStatus).toBe(400);
    expect(error.details).toEqual({ name: ['不能为空'] });
    expect(error.category).toBe('VALIDATION_ERROR');
  });
});
