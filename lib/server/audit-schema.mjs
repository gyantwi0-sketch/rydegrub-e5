// Trusted SQL specifications only: this module is never called with HTTP input.
// Triggers run in the mutation transaction, so failure rolls back both changes.
const definitions = {
  account: [
    ['member_created','INSERT','members','account.registered','account','new.owner','new.id'],
    ['password_changed','UPDATE OF password','members','account.password_changed','account','new.owner','new.id'],
    ['email_verified','UPDATE OF verified','members','account.verification_changed','account','new.owner','new.id','CAST(old.verified AS TEXT)','CAST(new.verified AS TEXT)','old.verified<>new.verified'],
    ['session_created','INSERT','sessions','auth.session_created','account','(SELECT owner FROM members WHERE id=new.member)'],
    ['session_removed','DELETE','sessions','auth.session_removed','account','(SELECT owner FROM members WHERE id=old.member)'],
    ['challenge_created','INSERT','tokens','account.challenge_created','account','(SELECT owner FROM members WHERE id=new.member)','NULL','NULL','new.purpose'],
    ['challenge_removed','DELETE','tokens','account.challenge_removed','account','(SELECT owner FROM members WHERE id=old.member)','NULL','old.purpose'],
  ],
  profile: [
    ['profile_created','INSERT','profiles','profile.created','account','new.owner'],
    ['profile_changed','UPDATE','profiles','profile.changed','account','new.owner'],
    ['profile_removed','DELETE','profiles','profile.removed','account','old.owner'],
    ['consent_changed','INSERT','consent_events','account.consent_changed','account','new.owner','new.purpose','NULL','CAST(new.granted AS TEXT)'],
    ['phone_challenge','INSERT','challenges','account.phone_challenge_created','account','new.owner'],
  ],
  media: [
    ['upload_started','INSERT','media','media.upload_started','account','new.owner','new.id','NULL','new.state'],
    ['upload_changed','UPDATE OF state','media','media.state_changed','account','new.owner','new.id','old.state','new.state','old.state<>new.state'],
    ['media_purged','DELETE','media','media.purged','service','old.owner','old.id','old.state',"'purged'"],
  ],
  tracking: [
    ['tracking_created','INSERT','orders','fulfilment.tracking_created','service','new.owner','new.id','NULL','new.stage'],
    ['tracking_changed','UPDATE','orders','fulfilment.tracking_changed','service','new.owner','new.id','old.stage','new.stage'],
    ['tracking_removed','DELETE','orders','fulfilment.tracking_removed','service','old.owner','old.id'],
    ['access_created','INSERT','tokens','tracking.access_issued','account','(SELECT owner FROM orders WHERE id=new.order_id)','new.order_id'],
    ['access_removed','DELETE','tokens','tracking.access_revoked','account','(SELECT owner FROM orders WHERE id=old.order_id)','old.order_id'],
  ],
  catalog: [
    ['product_created','INSERT','products','catalog.created','service','NULL','new.id'],
    ['product_changed','UPDATE','products','catalog.changed','service','NULL','new.id'],
    ['product_removed','DELETE','products','catalog.removed','service','NULL','old.id'],
  ],
  domain: [
    ['domain_account','INSERT','accounts','account.domain_linked','service','new.owner'],
    ['cart_created','INSERT','carts','cart.created','account','new.owner'],
    ['cart_changed','UPDATE','carts','cart.changed','account','new.owner'],
    ['order_created','INSERT','orders','order.created','account','new.owner','new.id','NULL','new.status'],
    ['order_changed','UPDATE OF status','orders','order.state_changed','service','new.owner','new.id','old.status','new.status','old.status<>new.status'],
    ['payment_created','INSERT','payment_attempts','payment.created','service','NULL','new.id','NULL','new.status'],
    ['payment_changed','UPDATE OF status','payment_attempts','payment.state_changed','service','NULL','new.id','old.status','new.status','old.status<>new.status'],
    ['fulfilment_created','INSERT','fulfilment_events','fulfilment.event_recorded','service','NULL','new.order_id','NULL','new.stage'],
    ['station_created','INSERT','stations','station.created','service','NULL','new.code'],
    ['station_changed','UPDATE','stations','station.changed','service','NULL','new.code'],
    ['vendor_created','INSERT','vendors','vendor.created','service','NULL','new.id'],
    ['vendor_changed','UPDATE','vendors','vendor.changed','service','NULL','new.id'],
    ['product_created','INSERT','catalog','catalog.created','service','NULL','new.sku'],
    ['product_changed','UPDATE','catalog','catalog.changed','service','NULL','new.sku'],
    ['product_removed','DELETE','catalog','catalog.removed','service','NULL','old.sku'],
  ],
};
export function installAudit(db, service) {
  const rules = definitions[service];
  if (!rules) throw new Error('Unsupported audit service.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS security_audit_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO security_audit_meta VALUES(1,1);
      CREATE TABLE IF NOT EXISTS security_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        actor_class TEXT NOT NULL CHECK(actor_class IN ('account','service')),
        owner_key TEXT,
        subject TEXT,
        from_state TEXT,
        to_state TEXT,
        recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS security_audit_owner ON security_audit(owner_key,id);
      CREATE TRIGGER IF NOT EXISTS security_audit_no_replace BEFORE INSERT ON security_audit WHEN EXISTS(SELECT 1 FROM security_audit WHERE id=new.id) BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS security_audit_no_update BEFORE UPDATE ON security_audit BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS security_audit_no_delete BEFORE DELETE ON security_audit BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;`);
    if (db.prepare('SELECT version FROM security_audit_meta WHERE singleton=1').get().version !== 1)
      throw new Error('Unsupported audit schema.');
    for (const [name,action,table,event,_actor,owner='NULL',subject='NULL',from='NULL',to='NULL',when='1'] of rules) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS audit_${service}_${name} AFTER ${action} ON ${table} WHEN ${when} BEGIN
        INSERT INTO security_audit(event,actor_class,owner_key,subject,from_state,to_state,recorded_at)
        VALUES('${event}','service',${owner},${subject},${from},${to},CAST(unixepoch('subsec')*1000 AS INTEGER)); END;`);
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
export function failedSignInAudit(db) {
  // Do not retain attempted email addresses or passwords for failed sign-ins.
  db.prepare(`INSERT INTO security_audit(event,actor_class,recorded_at)
    VALUES('auth.signin_failed','service',?)`).run(Date.now());
}
