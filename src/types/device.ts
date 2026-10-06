export type DeviceStatus = 'IDLE' | 'IN_USE' | 'MAINTENANCE' | 'DISABLED' | 'SCRAPPED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

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
}
