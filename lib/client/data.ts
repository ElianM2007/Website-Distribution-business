export type Product = { id: string; sku: string; name: string; category: string; unit: string; priceCents: number; stock: number; reorderLevel: number; active: boolean; updatedAt: string };
export type Status = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type Order = { id: string; number: string; customerName: string; customerEmail: string; status: Status; totalCents: number; createdAt: string; fulfillmentMethod: "delivery"|"pickup"; deliveryAddress: string; notes?: string; items: {productId: string; name: string; sku: string; quantity: number; unitPriceCents: number}[] };
export type User = { id: string; name: string; email: string; role: "staff" | "client"; status:"pending"|"approved"|"rejected" };
export type Dashboard = { revenueCents: number; orderCount: number; productCount: number; lowStockCount: number; revenueSeries: {label: string; value: number}[]; recentOrders: Order[]; lowStockProducts: Product[] };
export const money = (cents: number) => new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2}).format(cents / 100);
