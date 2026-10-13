import type { Product } from "./catalog-types";
export type { Product } from "./catalog-types";
export { PACK_NOTE } from "./catalog-types";
export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
export const journey = {
  train: "12952 Mumbai Rajdhani Express",
  from: "New Delhi",
  to: "Mumbai Central",
  coach: "B4",
  seat: "32",
  station: "Kota Junction",
};
export type Cart = Record<string, number>;
export type Profile = { name: string; mobile: string; preferences: string[] };
export type Order = {
  id: string;
  createdAt: number;
  items: { product: Product; quantity: number }[];
  subtotal: number;
  delivery: number;
  total: number;
  journey: typeof journey;
  passenger: {
    name: string;
    mobile: string;
    coach: string;
    seat: string;
    station: string;
    payment: string;
  };
};
export type ReorderLine = {
  previous: Product;
  current: Product | null;
  quantity: number;
  changes: string[];
};
export function prepareReorder(
  items: Order["items"],
  catalog: readonly Product[],
): { lines: ReorderLine[]; cart: Cart; subtotal: number } {
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const cart: Cart = {};
  let subtotal = 0;
  const lines = items.map(({ product: previous, quantity }) => {
    const current = byId.get(previous.id) ?? null;
    const changes: string[] = [];
    if (!current) changes.push("No longer available");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      changes.push("Invalid quantity");
    }
    if (current) {
      if (current.price !== previous.price)
        changes.push(`Price: ${money(previous.price)} → ${money(current.price)}`);
      if (current.allergens !== previous.allergens)
        changes.push(`Allergens: ${previous.allergens} → ${current.allergens}`);
      if (current.ingredients !== previous.ingredients)
        changes.push("Ingredients changed — review current details");
      if (current.age !== previous.age || current.packaged !== previous.packaged)
        changes.push("Age or packaging guidance changed");
      if (current.name !== previous.name) changes.push(`Now called ${current.name}`);
    }
    if (current && Number.isInteger(quantity) && quantity > 0 && quantity <= 99) {
      const combined = (cart[current.id] ?? 0) + quantity;
      if (combined <= 99) {
        cart[current.id] = combined;
        subtotal += current.price * quantity;
      } else {
        changes.push("Quantity exceeds the per-item limit");
      }
    }
    return { previous, current, quantity, changes };
  });
  return { lines, cart, subtotal };
}
export const totals = (cart: Cart, catalog: readonly Product[]) => {
  const subtotal = catalog.reduce(
    (sum, p) => sum + p.price * (cart[p.id] || 0),
    0,
  );
  const delivery = subtotal === 0 || subtotal >= 399 ? 0 : 20;
  return { subtotal, delivery, total: subtotal + delivery };
};
export const orderStatus = (createdAt: number, now: number) =>
  Math.min(4, Math.max(0, Math.floor((now - createdAt) / 15000)));
export const statuses = [
  "Confirmed",
  "Preparing",
  "Packed",
  "At your coach",
  "Delivered",
];
