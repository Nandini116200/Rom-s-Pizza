// Domain model. Money is integer paise to avoid float drift (₹1 = 100).
export type Paise = number;
export type Shift = 'LUNCH' | 'DINNER';
export type PaymentMethod = 'COD' | 'ONLINE';
export type OrderStatus =
  | 'RECEIVED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type DeliveryStatus =
  | 'ASSIGNED' | 'PREPARING_DISPATCH' | 'DISPATCHED' | 'DELIVERED' | 'FAILED' | 'RETURNED' | 'CANCELLED';

export interface OrderItem { pizza: string; qty: number; unitPrice: Paise }

export interface Order {
  id: string; outletId: string; ts: string; shift: Shift;
  customerRef?: string;
  items: OrderItem[];
  discount: Paise; tax: Paise;
  payment: PaymentMethod; status: OrderStatus;
}

export interface Receipt {
  id: string; orderId: string; ts: string; amount: Paise;
  voided?: boolean; // voiding is the only way to "remove" a receipt; never delete
}

export interface Delivery {
  id: string; orderId: string; personId: string; status: DeliveryStatus;
  dispatchTs?: string; closedTs?: string;
}

/** A COD collection. Never edited: a correction = reversal entry + new entry. */
export interface Collection {
  id: string; orderId: string; deliveryId: string; personId: string;
  amount: Paise; ts: string;
  reversesId?: string; // if set, this entry cancels collection `reversesId` (amount ignored)
}

export interface DepositAllocation { collectionId: string; amount: Paise }
export interface Deposit {
  id: string; outletId: string; ref: string; ts: string;
  declaredAmount: Paise;         // cash counted / bank slip
  allocations: DepositAllocation[];
  verifiedBy?: string;
}

/** Approved change to what a customer owes (refund, goodwill, price fix). Negative reduces due. */
export interface Adjustment { id: string; orderId: string; amount: Paise; reason: string; approvedBy: string; ts: string }

export interface ProductionBatch {
  id: string; outletId: string; ts: string; shift: Shift;
  pizza: string; qty: number; staffId: string; wasted?: number; notes?: string;
}

export interface Dataset {
  orders: Order[]; receipts: Receipt[]; deliveries: Delivery[];
  collections: Collection[]; deposits: Deposit[]; adjustments: Adjustment[];
  production: ProductionBatch[];
}

export interface ReconPolicy {
  depositDeadlineHours: number;   // collection older than this without deposit => overdue
  productionAllowancePct: number; // tolerated over-production per day/shift/pizza
  amountTolerance: Paise;         // ignore differences ≤ this
}

export const DEFAULT_POLICY: ReconPolicy = { depositDeadlineHours: 12, productionAllowancePct: 5, amountTolerance: 0 };
