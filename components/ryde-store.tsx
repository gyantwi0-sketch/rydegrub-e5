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
  return {
    cart,
    orders: [],
    selected: x?.selected === true,
    profile: {
      name: "",
      mobile: "",
      preferences: [],
    },
  };
}
export function RydeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try {
      // Remove older demo snapshots, which included passenger contact details.
      localStorage.removeItem("rydegrub-v1");
      const raw = localStorage.getItem("rydegrub-v2");
      if (raw) setState(restore(raw));
    } catch {
      setNotice("Saved demo data could not be loaded. Starting fresh.");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          "rydegrub-v2",
          JSON.stringify({
            cart: state.cart,
            selected: state.selected,
          }),
        );
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

