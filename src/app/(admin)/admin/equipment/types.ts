// 设备状态类型
export type DeviceStatus = 'IDLE' | 'IN_USE' | 'MAINTENANCE' | 'DISABLED' | 'SCRAPPED';
// 风险等级类型
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// 设备接口
export interface Device {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  location: string;
  riskLevel: RiskLevel;
  status: DeviceStatus;
  labId: string;
  scrappedAt?: string | null;
  scrappedReason?: string | null;
  createdAt: string;
  updatedAt: string;
  lab?: {
    id: string;
    name: string;
    location?: string;
  };
  // getDevice API 返回的关联使用记录（按 createdAt desc 排序）
  deviceUsages?: DeviceUsage[];
}

// 设备使用记录
export interface DeviceUsage {
  id: string;
  deviceId: string;
  userId: string;
  startTime: string;
  endTime: string | null;
  purpose: string | null;
  status: string; // NORMAL | ABNORMAL
  note: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
  };
}

// 申请使用设备请求
export interface CreateDeviceUsageRequest {
  userId: string;
  purpose: string;
  startTime: string;
  endTime: string;
}

// 创建设备请求
export interface CreateDeviceRequest {
  name: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  riskLevel?: RiskLevel;
  status?: DeviceStatus;
  labId: string;
}

// 设备列表查询参数
export interface DeviceQueryParams {
  search?: string;
  riskLevel?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
