import { timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { CatalogError, CatalogStore } from './catalog-store.mjs';
const stores=new Map();
function config(){const token=process.env.CATALOG_ADMIN_TOKEN,root=process.env.CATALOG_DATA_DIR;if(typeof token!=='string'||token.length<32||typeof root!=='string'||!isAbsolute(root))throw new CatalogError(503,'Catalog service is not configured.');return {token,root};}
function db(c){if(!stores.has(c.root))stores.set(c.root,new CatalogStore(c.root));return stores.get(c.root);}
function out(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
function auth(req,c){const m=/^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(req.headers.get('authorization')||'');if(!m)throw new CatalogError(401,'Admin authorization required.');const a=Buffer.from(m[1]),b=Buffer.from(c.token);if(a.length!==b.length||!timingSafeEqual(a,b))throw new CatalogError(403,'Admin authorization failed.');}
async function json(req){
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')throw new CatalogError(400,'JSON body required.');
 const len=req.headers.get('content-length');
 if(len&&(!/^\\d+$/.test(len)||+len>16384))throw new CatalogError(413,'Request too large.');
 if(!req.body)throw new CatalogError(400,'JSON body required.');
 const reader=req.body.getReader(),chunks=[];let size=0;
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new CatalogError(413,'Request too large.');}chunks.push(Buffer.from(value));}
 }catch(e){if(e instanceof CatalogError)throw e;throw new CatalogError(400,'Invalid request body.');}
 finally{try{reader.releaseLock();}catch{}}
 if(len!==null&&len!==undefined&&+len!==size)throw new CatalogError(400,'Invalid content length.');
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CatalogError(400,'Invalid JSON.');}
}
function run(req,fn,admin=false){return (async()=>{try{const c=config();if(new URL(req.url).search)throw new CatalogError(400,'Query parameters are not accepted.');if(admin)auth(req,c);return await fn(db(c));}catch(e){return out({error:e instanceof CatalogError?e.message:'Catalog service unavailable.'},e instanceof CatalogError?e.status:503);}})();}
export const catalogHandlers={
 list:req=>run(req,s=>{if(req.method!=='GET')throw new CatalogError(405,'Method not allowed.');const products=s.list();return out({products,categories:['All',...new Set(products.map(p=>p.category))]});}),
 create:req=>run(req,async s=>out({product:s.create(await json(req))},201),true),
 update:req=>run(req,async s=>out({product:s.update(await json(req))}),true),
 remove:req=>run(req,async s=>out({removed:s.remove((await json(req))?.id)}),true)
};
