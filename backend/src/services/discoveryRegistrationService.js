// Registers a hypervisor for discovery when an inventory record says it is one: OS Type "VMware ESXi" / "VMware vCenter" goes to
// Migration & Discovery > VMware Discovery, "Proxmox" to Proxmox Discovery. Runs after the record is saved; it never fails the save.
const db = require('../config/db');
const { encrypt, decrypt } = require('../utils/crypto');
const { getSetting } = require('./settingsService');
const { loginFields } = require('./hostnameRenameService');
const { audit } = require('./auditService');

/** Which discovery an OS Type value belongs to: 'vmware', 'proxmox' or null. */
const kindOf = (os) => (/proxmox/i.test(os || '') ? 'proxmox' : /esxi|vmware|vcenter|vsphere/i.test(os || '') ? 'vmware' : null);
const TABLE = { vmware: 'vmware_servers', proxmox: 'proxmox_servers' };
const NONE = '-';   // stored for a login that is not known yet (the column cannot be empty); the server stays disabled until it is replaced
const LABEL = { vmware: 'VMware Discovery', proxmox: 'Proxmox Discovery' };

async function freeName(table, base) {
  const taken = new Set((await db.query(`SELECT lower(name) AS n FROM ${table}`)).rows.map((r) => r.n));
  let name = base.slice(0, 120); let i = 2;
  while (taken.has(name.toLowerCase())) name = `${base.slice(0, 110)} (${i++})`;
  return name;
}

/**
 * `rec` = the saved inventory_records row. Resolves to null (nothing to do) or { kind, action, id, message }.
 * The record's own login is copied only for users allowed to view passwords, exactly as for renaming a host.
 */
async function sync(req, page, rec) {
  const kind = kindOf(rec.os_type);
  if (!kind || rec.is_decommissioned || rec.is_deleted) return null;
  const table = TABLE[kind]; const host = String(rec.ip_address || '').trim();
  if (!host) return { kind, action: 'skipped', message: `Not added to ${LABEL[kind]}: the record has no IP address.` };

  const cfg = await getSetting('hostname_pattern', {});
  const { user: uf, password: pf } = loginFields(page.config.fields || [], cfg);
  const username = uf ? String(rec.data[uf.key] || '').trim() : '';
  const enc = pf ? rec.secrets[pf.key] : null;
  const mayUse = !!(req.user.isSuper || req.user.can_view_passwords);
  let password = ''; try { if (enc && mayUse) password = decrypt(enc); } catch { password = ''; }

  const found = (await db.query(`SELECT * FROM ${table} WHERE record_id = $1 OR lower(host) = lower($2) ORDER BY (record_id = $1) DESC NULLS LAST LIMIT 1`, [rec.id, host])).rows[0];
  if (found && found.record_id !== rec.id) return { kind, action: 'exists', id: found.id, message: `Already in ${LABEL[kind]} as "${found.name}".` };

  if (kind === 'vmware') {
    const complete = !!(username && password);
    const why = !complete ? (mayUse ? 'Save a username and password on the record' : 'Needs a user who may view passwords') : null;
    if (!found) {
      const name = await freeName(table, rec.hostname || rec.vm_name || host);
      const { rows } = await db.query(
        `INSERT INTO vmware_servers (name, host, username, password_encrypted, verify_ssl, is_standalone_esxi, enabled, last_error, record_id)
         VALUES ($1,$2,$3,$4,FALSE,$5,$6,$7,$8) RETURNING id`, [name, host, username, encrypt(password || NONE), /esxi/i.test(rec.os_type), complete, why && `Login missing: ${why}, then enable the server here.`, rec.id]);
      audit(req, 'create', 'vmware_server', rows[0].id, { name, source: 'inventory record', record: rec.id });
      if (complete) require('./vmwareService').discover(rows[0].id).catch((e) => console.warn(`[discovery] first run for ${name}: ${e.message}`));
      return { kind, action: 'created', id: rows[0].id, message: complete ? `Added to ${LABEL[kind]} as "${name}"; the first discovery is running.` : `Added to ${LABEL[kind]} as "${name}" but disabled: ${why}.` };
    }
    // Registered earlier from this record: follow its IP address, and finish a login that was missing.
    const sets = []; const v = [];
    if (found.host !== host) { v.push(host); sets.push(`host = $${v.length}`); }
    const incomplete = !found.enabled && /^Login missing/.test(found.last_error || '');
    if (incomplete && complete) { v.push(username); sets.push(`username = $${v.length}`); v.push(encrypt(password)); sets.push(`password_encrypted = $${v.length}`); sets.push('enabled = TRUE', 'last_error = NULL'); }
    if (found.host !== host && !(incomplete && complete) && password) { v.push(username || found.username); sets.push(`username = $${v.length}`); v.push(encrypt(password)); sets.push(`password_encrypted = $${v.length}`); }   // a moved server needs its secret again
    if (!sets.length) return { kind, action: 'unchanged', id: found.id };
    v.push(found.id); await db.query(`UPDATE vmware_servers SET ${sets.join(', ')} WHERE id = $${v.length}`, v);
    audit(req, 'update', 'vmware_server', found.id, { name: found.name, source: 'inventory record' });
    if (incomplete && complete) require('./vmwareService').discover(found.id).catch(() => {});
    return { kind, action: 'updated', id: found.id, message: `${LABEL[kind]} entry "${found.name}" updated from the record.` };
  }

  // Proxmox is reached with an API token (user@realm!name + secret), which an asset record does not hold: register it disabled.
  if (found) {
    if (found.host === host) return { kind, action: 'unchanged', id: found.id };
    if (found.token_id) return { kind, action: 'unchanged', id: found.id };   // a working entry is never moved without its token being typed again
    await db.query('UPDATE proxmox_servers SET host = $1 WHERE id = $2', [host, found.id]);
    return { kind, action: 'updated', id: found.id, message: `${LABEL[kind]} entry "${found.name}" now uses ${host}.` };
  }
  const name = await freeName(table, rec.hostname || rec.vm_name || host);
  const { rows } = await db.query(
    `INSERT INTO proxmox_servers (name, host, port, token_id, token_secret_encrypted, verify_ssl, enabled, last_error, record_id)
     VALUES ($1,$2,8006,'',$3,FALSE,FALSE,$4,$5) RETURNING id`, [name, host, encrypt(NONE), 'API token needed: add the token ID and secret here, then enable the server.', rec.id]);
  audit(req, 'create', 'proxmox_server', rows[0].id, { name, source: 'inventory record', record: rec.id });
  return { kind, action: 'created', id: rows[0].id, message: `Added to ${LABEL[kind]} as "${name}" but disabled: Proxmox needs an API token. Add it there.` };
}

/** Never lets a problem here fail or slow the save: the record is already stored. */
async function safeSync(req, page, rec) {
  try { return await sync(req, page, rec); } catch (e) { console.warn(`[discovery] could not register ${rec && rec.id}: ${e.message}`); return null; }
}

module.exports = { sync: safeSync, kindOf };
