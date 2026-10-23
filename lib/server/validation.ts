import { z } from "zod";

const cleanText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), "Unsupported control character");
export const uuid = z.string().uuid();
const productFields = {
  sku: z.string().trim().min(2).max(48).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).transform(v => v.toUpperCase()),
  name: cleanText(2, 120), category: cleanText(1,60), unit: cleanText(1,24),
  priceCents: z.number().int().min(0).max(100000000), reorderLevel: z.number().int().min(0).max(1000000),
  active: z.boolean().optional(),
};
export const createProductSchema = z.object({ ...productFields, stock: z.number().int().min(0).max(1000000) }).strict();
export const patchProductSchema = z.object(productFields).partial().strict().refine(v => Object.keys(v).length > 0, "Provide at least one field");
export const stockSchema = z.object({ delta: z.number().int().min(-1000000).max(1000000).refine(v => v !== 0), reason: cleanText(3,240) }).strict();
export const createOrderSchema = z.object({
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(50)
    .refine(v => new Set(v.map(i => i.productId)).size === v.length, "Combine duplicate products"),
  fulfillmentMethod: z.enum(["delivery","pickup"]).default("delivery"),
  deliveryAddress: cleanText(0,500).default(""), notes: cleanText(0,1000).optional(),
}).strict().superRefine((value,ctx) => {
  if (value.fulfillmentMethod === "delivery" && value.deliveryAddress.length < 8) ctx.addIssue({code:z.ZodIssueCode.custom,path:["deliveryAddress"],message:"A delivery address of at least 8 characters is required"});
});
export const orderStatusSchema = z.object({ status: z.enum(["confirmed","shipped","delivered","cancelled"]) }).strict();
export const emptyQuerySchema = z.object({}).strict();
export const listQuerySchema = z.object({
  limit: z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().int().min(1).max(1000)).optional(),
  offset: z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(0).max(100000)).optional(),
}).strict();
export const transitions: Record<string, readonly string[]> = {
  pending: ["confirmed","cancelled"], confirmed: ["shipped","cancelled"], shipped: ["delivered"], delivered: [], cancelled: [],
};
export function canTransition(from: string, to: string, fulfillment = "delivery"): boolean {
  if (fulfillment === "pickup") return ({pending:["confirmed","cancelled"],confirmed:["delivered","cancelled"],delivered:[],cancelled:[]} as Record<string,string[]>)[from]?.includes(to) ?? false;
  return transitions[from]?.includes(to) ?? false;
}
const email = z.string().trim().max(254).email().transform(value => value.toLowerCase());
const password = z.string().min(12,"Use at least 12 characters").max(128,"Use no more than 128 characters");
export const registerSchema = z.object({name:cleanText(2,120),email,password}).strict();
export const loginSchema = z.object({email,password}).strict();
export const bootstrapSchema = z.object({name:cleanText(2,120),email,password,setupToken:z.string().min(32).max(512)}).strict();
export const accountStatusSchema = z.object({status:z.enum(["approved","rejected","pending"])}).strict();
export const categorySchema = z.object({name:cleanText(1,60)}).strict();
