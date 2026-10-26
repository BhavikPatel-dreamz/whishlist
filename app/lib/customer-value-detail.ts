export type CustomerValueSegment = "guest" | "logged-in";

export type CustomerValueDetailRow = {
  customer: string;
  order: string;
  orderedAt: string | null;
  product: string;
  variant: string;
  source: string;
  revenue: number;
};

export type CustomerValueDetail = {
  segment: CustomerValueSegment;
  title: string;
  customers: number;
  orders: number;
  products: number;
  rows: CustomerValueDetailRow[];
};
