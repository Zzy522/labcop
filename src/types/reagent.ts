export type RiskLevel = 'LOW' | 'HIGH';
export type ReagentAction = 'STOCK_IN' | 'STOCK_OUT' | 'ADJUST' | 'ARCHIVE';

export interface Reagent {
  id: string;
  name: string;
  casNumber: string;
  specification: string;
  brand: string;
  dangerCategory: string;
  riskLevel: RiskLevel;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string;
  stockQuantity: number;
  minStock: number;
  unit: string;
  batchNumber: string;
  expiryDate: string | null;
  labId: string;
  // 入库信息
  stockInDate: string | null;
  stockInOperatorId: string | null;
  // PubChem 自动填充字段
  structureImgUrl: string | null;
  molecularFormula: string | null;
  molecularWeight: string | null;
  iupacName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReagentFormData {
  name: string;
  casNumber: string;
  specification: string;
  brand: string;
  dangerCategory: string;
  riskLevel: RiskLevel;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string;
  stockQuantity: number;
  minStock: number;
  unit: string;
  batchNumber: string;
  expiryDate: string;
  labId: string;
}
