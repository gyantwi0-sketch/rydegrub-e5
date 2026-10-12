"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { products, type Cart, type Order, type Profile } from "@/lib/rydegrub";
type State = {
  cart: Cart;
  selected: boolean;
  orders: Order[];
  profile: Profile;
};
const initial: State = {
  cart: {},
  selected: false,
  orders: [],
  profile: { name: "", mobile: "", preferences: [] },
};
const Context = createContext<null | {
  state: State;
  ready: boolean;
  notice: string;
  setState: React.Dispatch<React.SetStateAction<State>>;
  quantity: (id: string, n: number) => void;
  notify: (s: string) => void;
}>(null);
function restore(raw: string): State {
  const x = JSON.parse(raw);
  const cart: Cart = {};
  for (const p of products)
    if (Number.isInteger(x?.cart?.[p.id]) && x.cart[p.id] > 0)
      cart[p.id] = Math.min(99, x.cart[p.id]);
  const orders = Array.isArray(x?.orders)
    ? x.orders.filter(
        (o: Order) =>
          typeof o?.id === "string" &&
          Number.isFinite(o.createdAt) &&
          o.createdAt > 0 &&
          Array.isArray(o.items) &&
          o.items.length > 0 &&
          o.items.every(
            (i) =>
              products.some((p) => p.id === i?.product?.id) &&
              typeof i.product.name === "string" &&
              typeof i.product.image === "string" &&
              Number.isFinite(i.product.price) &&
              Number.isInteger(i.quantity) &&
              i.quantity > 0,
          ) &&
          ["subtotal", "delivery", "total"].every((k) =>
            Number.isFinite(o[k as keyof Order]),
          ) &&
          o.journey &&
          ["train", "from", "to", "coach", "seat", "station"].every(
            (k) => typeof o.journey[k as keyof Order["journey"]] === "string",
          ) &&
          o.passenger &&
          ["name", "mobile", "coach", "seat", "station", "payment"].every(
            (k) =>
              typeof o.passenger[k as keyof Order["passenger"]] === "string",
          ),
      )
    : [];
  return {
    cart,
    orders,
    selected: x?.selected === true,
    profile: {
      name: typeof x?.profile?.name === "string" ? x.profile.name : "",
      mobile: typeof x?.profile?.mobile === "string" ? x.profile.mobile : "",
      preferences: Array.isArray(x?.profile?.preferences)
        ? x.profile.preferences.filter((p: unknown) =>
            ["Vegetarian", "High-protein", "Mild spice"].includes(String(p)),
          )
        : [],
    },
  };
}
export function RydeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("rydegrub-v1");
      if (raw) setState(restore(raw));
    } catch {
      setNotice("Saved demo data could not be loaded. Starting fresh.");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("rydegrub-v1", JSON.stringify(state));
      } catch {
        setNotice(
          "Browser storage is unavailable. Changes last only for this visit.",
        );
      }
  }, [state, ready]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const quantity = (id: string, n: number) => {
    if (!ready) return;
    setState((s) => {
      const cart = { ...s.cart };
      if (n <= 0) delete cart[id];
      else cart[id] = Math.min(99, n);
      return { ...s, cart };
    });
  };
  return (
    <Context.Provider
      value={{ state, setState, ready, notice, quantity, notify: setNotice }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRyde() {
  const c = useContext(Context);
  if (!c) throw new Error("RydeProvider required");
  return c;
}
