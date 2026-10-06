export type RequisitionStatus = 'PENDING' | 'APPROVED' | 'NEEDS_CONFIRM' | 'BLOCKED' | 'REJECTED';

export interface Requisition {
  id: string;
  reagentId: string;
  reagentName?: string;
  applicantId: string;
  applicantName?: string;
  quantity: number;
  purpose: string;
  status: RequisitionStatus;
  reviewResult: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
