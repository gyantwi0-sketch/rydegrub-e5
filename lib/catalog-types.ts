export type Product = {
 id:string; name:string; price:number; category:string; description:string; image:string; veg:boolean; rating:string;
 ingredients:string; allergens:string; calories:number; protein:number; tags:string[]; age?:string; packaged?:boolean;
};
export const PACK_NOTE = "Check pack for age suitability and preparation.";
