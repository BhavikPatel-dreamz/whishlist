export type RecurringCustomerOrderProduct = {
  title: string;
  variant: string;
  quantity: number;
  source: string;
  revenue: number;
};

export type RecurringCustomerOrder = {
  orderId: string;
  orderNumber: string;
  orderedAt: string;
  products: RecurringCustomerOrderProduct[];
};

export type RecurringCustomerDetail = {
  customerId: string;
  customer: string;
  saves: number;
  subscriptions: number;
  clicks: number;
  orders: number;
  spend: number;
  orderDetails: RecurringCustomerOrder[];
};
