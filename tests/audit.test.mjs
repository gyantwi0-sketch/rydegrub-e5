import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccountStore } from '../lib/server/account-store.mjs';
import { ProfileStore } from '../lib/server/profile-store.mjs';
import { MediaStore } from '../lib/server/media-store.mjs';
import { TrackingStore } from '../lib/server/tracking-store.mjs';
import { DomainStore } from '../lib/server/domain-store.mjs';
const owner='a'.repeat(64);
function fixture(t,Type){const root=mkdtempSync(join(tmpdir(),'ryde-audit-'));const store=new Type(root);t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});store.fixtureRoot=root;return store;}
const events=store=>store.db.prepare('SELECT * FROM security_audit ORDER BY id').all();
test('audit events reject update, delete and replace; survive reopen; failed writes roll back business data',t=>{
 const store=fixture(t,ProfileStore);store.update(owner,{name:'Private Name',preferences:[]});
 const reopened=new ProfileStore(store.fixtureRoot);assert.equal(events(reopened).length,1);reopened.close();
 const first=events(store)[0];assert.equal(first.event,'profile.created');assert.equal(first.owner_key,owner);
 assert.throws(()=>store.db.prepare('UPDATE security_audit SET event=? WHERE id=?').run('altered',first.id),/append-only/);
 assert.throws(()=>store.db.prepare('DELETE FROM security_audit WHERE id=?').run(first.id),/append-only/);
 assert.throws(()=>store.db.prepare("INSERT OR REPLACE INTO security_audit(id,event,actor_class,recorded_at) VALUES(?,'altered','service',1)").run(first.id),/append-only/);
 store.db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON security_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.throws(()=>store.update(owner,{name:'Changed Name',preferences:[]}),/audit unavailable/);
 assert.equal(store.read(owner).name,'Private Name');assert.equal(events(store).length,1);
});
test('account audit records sessions, verification and failed sign-in without passwords, email or token digests',async t=>{
 const store=fixture(t,AccountStore),password='synthetic-password-never-log-987';
 const account=await store.register({email:'private@example.test',name:'Private Name',password},async()=>false);
 const session=await store.signIn(account.email,password);const code=store.issueToken(account.email,'verify');await store.redeem(code.token,'verify');
 await assert.rejects(store.signIn(account.email,'wrong-password-fixture'),{status:401});store.logout(session.token);
 const rows=events(store),names=rows.map(x=>x.event),serialized=JSON.stringify(rows);
 for(const name of ['account.registered','auth.session_created','account.verification_changed','auth.signin_failed','auth.session_removed'])assert.ok(names.includes(name));
 for(const value of [password,account.email,'Private Name',session.token,code.token])assert.ok(!serialized.includes(value));
 assert.ok(rows.every(x=>x.recorded_at>0&&x.actor_class==='service'));
});
test('profile consent, phone challenges, media and tracking writes have minimal audit records',t=>{
 const profile=fixture(t,ProfileStore);profile.consent(owner,{purpose:'marketing',granted:true});profile.beginPhone(owner,'9876543210','pepper-32-characters-test-value');
 const media=fixture(t,MediaStore);const upload=media.reserve(owner);media.abandon(upload,owner);media.cleanup();
 const tracking=fixture(t,TrackingStore);const order=tracking.create(owner,{stage:'confirmed',station:'New Delhi',eta:null});
 const access=tracking.issueToken(order.id,owner);tracking.update(order.id,1,{stage:'preparing',station:'New Delhi',eta:null});tracking.revokeToken(order.id,owner);
 assert.ok(events(profile).some(x=>x.event==='account.consent_changed'));assert.ok(events(media).some(x=>x.event==='media.purged'));assert.ok(events(tracking).some(x=>x.event==='tracking.access_revoked'));
 const text=JSON.stringify([...events(profile),...events(media),...events(tracking)]);
 assert.ok(!text.includes('9876543210'));assert.ok(!text.includes(access.token));assert.ok(!text.includes('New Delhi'));
});
test('checkout, payment, catalog and fulfilment audits commit with domain transitions and omit PNR/provider references',t=>{
 const store=fixture(t,DomainStore);store.createAccount(owner,randomUUID());store.addStation({code:'NDLS',name:'New Delhi'});store.addStation({code:'KOTA',name:'Kota Junction'});
 const vendorId=store.addVendor({stationCode:'KOTA',name:'Kitchen Vendor'});store.putProduct({sku:'meal',vendorId,name:'Meal Bowl',pricePaise:12000,active:true});
 const journey=store.addJourney(owner,{pnrDigest:'d'.repeat(64),trainNo:'12952',origin:'NDLS',destination:'KOTA'});
 store.replaceCart(owner,0,[{sku:'meal',quantity:1}]);const order=store.createDraftOrder(owner,journey,1,randomUUID());
 const payment=store.startPayment(owner,order.id,1);store.applyGatewayEvent({paymentId:payment.paymentId,expectedVersion:1,nextState:'authorized',providerRefDigest:'c'.repeat(64)});
 store.applyGatewayEvent({paymentId:payment.paymentId,expectedVersion:2,nextState:'captured',providerRefDigest:'c'.repeat(64)});
 const version=store.db.prepare('SELECT version FROM orders WHERE id=?').get(order.id).version;
 store.recordFulfilment({orderId:order.id,expectedVersion:version,stage:'preparing',stationCode:'KOTA'});
 const rows=events(store),names=rows.map(x=>x.event);for(const name of ['catalog.created','cart.created','order.created','order.state_changed','payment.state_changed','fulfilment.event_recorded'])assert.ok(names.includes(name));
 const before=rows.length;assert.throws(()=>store.applyGatewayEvent({paymentId:payment.paymentId,expectedVersion:2,nextState:'captured',providerRefDigest:'c'.repeat(64)}),{status:409});assert.equal(events(store).length,before);
 const text=JSON.stringify(rows);assert.ok(!text.includes('d'.repeat(64)));assert.ok(!text.includes('c'.repeat(64)));assert.ok(!text.includes('12000'));
});
