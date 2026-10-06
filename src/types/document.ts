export type DocumentType = 'PURCHASE' | 'RECEIPT' | 'STOCK_IN' | 'OTHER';
export type DocumentStatus = 'QUEUED' | 'PROCESSING' | 'PENDING' | 'CONFIRMED' | 'SKIPPED' | 'REJECTED';

export interface Document {
  id: string;
  type: DocumentType;
  fileUrl: string;
  fileName: string;
  recognitionResult: string | null;
  status: DocumentStatus;
  uploadedById: string;
  createdAt: string;
}
