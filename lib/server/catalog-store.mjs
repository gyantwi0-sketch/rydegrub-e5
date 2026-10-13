import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { products as seed } from './catalog-seed.mjs';
export class CatalogError extends Error { constructor(status,message){super(message);this.status=status;} }
const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateProduct(p){
 const str=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['id','name','price','category','description','image','veg','rating','ingredients','allergens','calories','protein','tags','age','packaged'].includes(k))||
 !str(p.id,80)||!idPattern.test(p.id)||!str(p.name,120)||!Number.isSafeInteger(p.price)||p.price<1||p.price>100000||
 !str(p.category,60)||!str(p.description,500)||typeof p.image!=='string'||p.image.length>500||
 !(p.image.startsWith('/images/')&&!p.image.includes('..')&&!p.image.includes('\\'))||
 typeof p.veg!=='boolean'||typeof p.rating!=='string'||!/^(?:[0-4](?:\.\d)?|5(?:\.0)?)$/.test(p.rating)||
 !str(p.ingredients,500)||!str(p.allergens,300)||!Number.isSafeInteger(p.calories)||p.calories<0||p.calories>10000||
 !Number.isSafeInteger(p.protein)||p.protein<0||p.protein>1000||!Array.isArray(p.tags)||p.tags.length>20||!p.tags.every(t=>str(t,40))||
 (p.age!==undefined&&!str(p.age,40))||(p.packaged!==undefined&&typeof p.packaged!=='boolean')) throw new CatalogError(400,'Invalid catalog product.');
 return {id:p.id,name:p.name.trim(),price:p.price,category:p.category.trim(),description:p.description.trim(),image:p.image,veg:p.veg,rating:p.rating,ingredients:p.ingredients.trim(),allergens:p.allergens.trim(),calories:p.calories,protein:p.protein,tags:[...new Set(p.tags.map(t=>t.trim()))],...(p.age===undefined?{}:{age:p.age.trim()}),...(p.packaged===undefined?{}:{packaged:p.packaged})};
}
export class CatalogStore{
 constructor(root){if(typeof root!=='string'||!isAbsolute(root))throw new CatalogError(503,'Catalog data directory must be an absolute path.');mkdirSync(root,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(root,'catalog.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,document TEXT NOT NULL,updated INTEGER NOT NULL)');if(this.db.prepare('SELECT COUNT(*) count FROM products').get().count===0){const ins=this.db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?)');for(const item of seed){const p=validateProduct(item);ins.run(p.id,JSON.stringify(p),Date.now());}}}
 list(){return this.db.prepare('SELECT document FROM products ORDER BY rowid').all().map(r=>JSON.parse(r.document));}
 create(input){const p=validateProduct(input);try{this.db.prepare('INSERT INTO products VALUES(?,?,?)').run(p.id,JSON.stringify(p),Date.now());}catch(e){if(this.db.prepare('SELECT id FROM products WHERE id=?').get(p.id))throw new CatalogError(409,'Product ID already exists.');throw e;}return p;}
 update(input){const p=validateProduct(input);const r=this.db.prepare('UPDATE products SET document=?,updated=? WHERE id=?').run(JSON.stringify(p),Date.now(),p.id);if(!r.changes)throw new CatalogError(404,'Product not found.');return p;}
 remove(id){if(typeof id!=='string'||!idPattern.test(id))throw new CatalogError(400,'Invalid product ID.');if(!this.db.prepare('DELETE FROM products WHERE id=?').run(id).changes)throw new CatalogError(404,'Product not found.');return {id};}
}
