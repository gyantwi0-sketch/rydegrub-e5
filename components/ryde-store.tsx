"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Product, Cart, Order, Profile } from "@/lib/rydegrub";
import { CartClient } from "@/lib/client/cart-client.mjs";

type State = { cart: Cart; selected: boolean; orders: Order[]; profile: Profile };
type Line = { sku: string; name: string; quantity: number; unitPaise: number };
type ServerCart = { mode: string; busy: boolean; error: string; lines: Line[];
  guest: { version: number; items: Line[] } | null; available: { sku: string; unitPaise: number }[] };
const initial: State = { cart: {}, selected: false, orders: [], profile: { name: "", mobile: "", preferences: [] } };
const Context = createContext<null | {
  state: State; products: Product[]; catalogMode: string; categories: string[]; ready: boolean;
  notice: string; serverCart: ServerCart;
  setState: React.Dispatch<React.SetStateAction<State>>;
  quantity: (id: string, n: number) => void;
  replaceCart: (cart: Cart) => Promise<boolean>;
  mergeGuest: (mode: string) => void; reloadCart: () => void; notify: (s: string) => void;
}>(null);
export function RydeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [catalogMode, setCatalogMode] = useState("loading");
  const [notice, setNotice] = useState("");
  const [serverCart, setServerCart] = useState<ServerCart>({ mode: "loading", busy: true, error: "", lines: [], guest: null, available: [] });
  const client = useRef<CartClient | null>(null);
  useEffect(() => {
    let active = true;
    const cart = new CartClient({ onChange: snapshot => {
      if (!active) return;
      setServerCart(snapshot);
      setState(s => ({ ...s, cart: snapshot.cart }));
    } });
    client.current = cart;
    // Legacy browser carts are never imported into authenticated or guest state.
    try { localStorage.removeItem("rydegrub-v1"); localStorage.removeItem("rydegrub-v2"); } catch {}
    void (async () => {
      try {
        const r = await fetch("/api/catalog", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const result = await r.json();
        if (!r.ok || !Array.isArray(result.products)) throw new Error();
        if (active) { setCatalog(result.products); setCatalogMode(result.mode); }
      } catch { if (active) setCatalogMode("unavailable"); }
      if (active) await cart.load();
    })();
    const refresh = () => { void cart.load(); };
    const focus = () => { if (cart.state.mode !== "demo") refresh(); };
    const sessionRefresh = () => { setState(initial); refresh(); };
    window.addEventListener("ryde-session", sessionRefresh);
    window.addEventListener("pageshow", focus);
    window.addEventListener("focus", focus);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("ryde-session") : null;
    if (channel) channel.onmessage = sessionRefresh;
    return () => { active = false; cart.dispose(); client.current = null; channel?.close(); window.removeEventListener("ryde-session", sessionRefresh); window.removeEventListener("pageshow", focus); window.removeEventListener("focus", focus); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);
  const prices = new Map(serverCart.available.map(p => [p.sku, p.unitPaise / 100]));
  const lineMap = new Map(serverCart.lines.map(p => [p.sku, p]));
  const products = catalog.map(p => ({ ...p, price: lineMap.get(p.id)?.unitPaise !== undefined ? lineMap.get(p.id)!.unitPaise / 100 : prices.get(p.id) ?? p.price }));
  for (const line of serverCart.lines) if (!products.some(p => p.id === line.sku)) products.push({ id: line.sku, name: line.name, price: line.unitPaise / 100,
    category: "Unavailable", description: "Remove this item and review the current menu.", image: "/placeholder.svg", veg: false, rating: "0", ingredients: "Unavailable", allergens: "Not verified", calories: 0, protein: 0, tags: [] });
  const ready = catalogMode !== "loading" && catalogMode !== "unavailable" && ["demo","guest","account"].includes(serverCart.mode);
  const replaceCart = async (cart: Cart) => {
    if (serverCart.mode === "demo") { setState(s => ({ ...s, cart })); return true; }
    try { return (await client.current?.replace(cart)) === true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "Cart update failed."); return false; }
  };
  const quantity = (id: string, n: number) => {
    if (!ready || serverCart.busy) { setNotice("Wait for your cart to finish loading."); return; }
    if (n > 0 && serverCart.mode !== "demo" && !prices.has(id)) { setNotice("This item is not currently available for ordering."); return; }
    const cart = { ...state.cart };
    if (n <= 0) delete cart[id]; else cart[id] = Math.min(99, Math.floor(n));
    void replaceCart(cart);
  };
  return <Context.Provider value={{ state, products, catalogMode, categories: ["All", ...new Set(catalog.map(p => p.category))], ready, notice,
    serverCart, setState, quantity, replaceCart, mergeGuest: mode => { void client.current?.merge(mode).catch(error => setNotice(error.message)); },
    reloadCart: () => { void client.current?.load(); }, notify: setNotice }}>{children}</Context.Provider>;
}
export function useRyde() { const c = useContext(Context); if (!c) throw Error("RydeProvider required"); return c; }
