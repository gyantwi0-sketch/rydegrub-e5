"use client";
import { createContext,useContext,useEffect,useState,type ReactNode } from "react";
import type { Product, Cart, Order, Profile } from "@/lib/rydegrub";
type State={cart:Cart;selected:boolean;orders:Order[];profile:Profile};
const initial:State={cart:{},selected:false,orders:[],profile:{name:"",mobile:"",preferences:[]}};
const Context=createContext<null|{state:State;products:Product[];categories:string[];ready:boolean;notice:string;setState:React.Dispatch<React.SetStateAction<State>>;quantity:(id:string,n:number)=>void;notify:(s:string)=>void}>(null);
function restore(raw:string,catalog:Product[]):State{const x=JSON.parse(raw),cart:Cart={};for(const p of catalog)if(Number.isInteger(x?.cart?.[p.id])&&x.cart[p.id]>0)cart[p.id]=Math.min(99,x.cart[p.id]);return {cart,orders:[],selected:x?.selected===true,profile:{name:"",mobile:"",preferences:Array.isArray(x?.preferences)?x.preferences.filter((p:unknown)=>["Vegetarian","High-protein","Mild spice"].includes(String(p))):[]}};}
export function RydeProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<State>(initial),[products,setProducts]=useState<Product[]>([]),[categories,setCategories]=useState<string[]>(["All"]),[ready,setReady]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{let active=true;(async()=>{let catalog:Product[]=[];try{const r=await fetch("/api/catalog",{cache:"no-store"});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.products)||!Array.isArray(d.categories))throw Error();catalog=d.products;if(active){setProducts(catalog);setCategories(d.categories);}}catch{if(active)setNotice("The menu is temporarily unavailable. Please try again later.");}if(!active)return;try{localStorage.removeItem("rydegrub-v1");const raw=localStorage.getItem("rydegrub-v2");if(raw)setState(restore(raw,catalog));}catch{setNotice("Saved demo data could not be loaded. Starting fresh.");}setReady(true);})();return()=>{active=false;};},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem("rydegrub-v2",JSON.stringify({cart:state.cart,selected:state.selected,preferences:state.profile.preferences}));}catch{setNotice("Browser storage is unavailable. Changes last only for this visit.");}},[state,ready]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(""),3500);return()=>clearTimeout(t);},[notice]);
 const quantity=(id:string,n:number)=>{if(!ready||!products.some(p=>p.id===id))return;setState(s=>{const cart={...s.cart};if(n<=0)delete cart[id];else cart[id]=Math.min(99,Math.floor(n));return {...s,cart};});};
 return <Context.Provider value={{state,products,categories,ready,notice,setState,quantity,notify:setNotice}}>{children}</Context.Provider>;
}
export function useRyde(){const c=useContext(Context);if(!c)throw Error("RydeProvider required");return c;}
