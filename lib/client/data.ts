export type Product = { id: string; sku: string; name: string; category: string; unit: string; priceCents: number; stock: number; reorderLevel: number; active: boolean; updatedAt: string };
export type Status = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type Order = { id: string; number: string; customerName: string; customerEmail: string; status: Status; totalCents: number; createdAt: string; deliveryAddress: string; notes?: string; items: {productId: string; name: string; sku: string; quantity: number; unitPriceCents: number}[] };
export type User = { id: string; name: string; email: string; role: "staff" | "client" };
export type Dashboard = { revenueCents: number; orderCount: number; productCount: number; lowStockCount: number; revenueSeries: {label: string; value: number}[]; recentOrders: Order[]; lowStockProducts: Product[] };
export const money = (cents: number) => new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2}).format(cents / 100);
export const sampleProducts: Product[] = [
  {id:"p1",sku:"BEV-001",name:"Sparkling mineral water",category:"Beverages",unit:"Case · 24 × 330 ml",priceCents:1850,stock:248,reorderLevel:50,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p2",sku:"PAN-012",name:"Extra virgin olive oil",category:"Pantry",unit:"Case · 12 × 500 ml",priceCents:7200,stock:18,reorderLevel:25,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p3",sku:"BEV-008",name:"House blend coffee",category:"Beverages",unit:"Box · 6 × 1 kg",priceCents:9600,stock:86,reorderLevel:20,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p4",sku:"PAN-024",name:"Organic penne pasta",category:"Pantry",unit:"Case · 24 × 500 g",priceCents:4200,stock:12,reorderLevel:30,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p5",sku:"CLN-003",name:"All-purpose cleaner",category:"Essentials",unit:"Case · 6 × 2 L",priceCents:3450,stock:132,reorderLevel:25,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p6",sku:"PKG-015",name:"Kraft takeaway boxes",category:"Packaging",unit:"Pack · 250 units",priceCents:2850,stock:8,reorderLevel:15,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p7",sku:"PAN-009",name:"Wildflower honey",category:"Pantry",unit:"Case · 12 × 350 g",priceCents:5600,stock:64,reorderLevel:20,active:true,updatedAt:"2026-10-22T10:00:00Z"},
  {id:"p8",sku:"PKG-021",name:"Compostable paper cups",category:"Packaging",unit:"Box · 1,000 units",priceCents:4800,stock:43,reorderLevel:15,active:true,updatedAt:"2026-10-22T10:00:00Z"},
];
const customers = ["The Green Fork", "Oak & Ember Café", "Harbor Market", "Sunday Provisions", "Cedar House", "The Green Fork"];
export const sampleOrders: Order[] = customers.map((customerName,i)=>({id:`o${i}`,number:`ORD-${1048-i}`,customerName,customerEmail:`orders@${customerName.toLowerCase().replace(/[^a-z]/g,"")}.example`,status:(["pending","confirmed","shipped","delivered","pending","delivered"] as Status[])[i],totalCents:[148000,86400,214500,67200,125600,184000][i],createdAt:`2026-10-${22-Math.floor(i/2)}T${10+i}:24:00Z`,deliveryAddress:"124 Market Street, Warehouse district",items:[{productId:sampleProducts[i].id,name:sampleProducts[i].name,sku:sampleProducts[i].sku,quantity:[80,12,22,16,36,64][i],unitPriceCents:sampleProducts[i].priceCents}]}));
export const sampleDashboard: Dashboard = {revenueCents:4826500,orderCount:156,productCount:8,lowStockCount:3,revenueSeries:[{label:"May",value:1820000},{label:"Jun",value:2490000},{label:"Jul",value:2260000},{label:"Aug",value:3420000},{label:"Sep",value:3190000},{label:"Oct",value:4826500}],recentOrders:sampleOrders,lowStockProducts:sampleProducts.filter(p=>p.stock<=p.reorderLevel)};
