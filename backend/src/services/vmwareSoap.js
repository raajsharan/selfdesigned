// Minimal vSphere SOAP (vim25) client for hosts that have no REST API: a standalone ESXi 6.x host (root login) or an old vCenter.
// It signs in, reads every virtual machine and host with one property-collector query, and signs out. Read-only: nothing is changed on the host.
const { requestJson } = require('../utils/http');

const NS = 'xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** One SOAP call. Returns the response body text; a SOAP fault becomes an Error (a login fault becomes "Authentication failed"). */
async function call(ctx, body) {
  const r = await requestJson(`${ctx.base}/sdk`, {
    method: 'POST', verifySsl: ctx.verifySsl, timeoutMs: 60000,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml', SOAPAction: `"urn:vim25/${ctx.version}"`, ...(ctx.cookie ? { Cookie: ctx.cookie } : {}) },
    body: `<soapenv:Envelope ${NS}><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`,
  });
  const text = r.text || '';
  const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) {
    const msg = unesc(fault[1]).trim();
    if (/incorrect user name or password|InvalidLogin|Cannot complete login/i.test(msg) || /<(?:\w+:)?InvalidLogin/.test(text)) throw new Error('Authentication failed (check username/password)');
    if (/NoPermission|permission to perform/i.test(msg)) throw new Error(`This account has no permission to read the inventory (${msg.slice(0, 120)})`);
    throw new Error(`vSphere error: ${msg.slice(0, 200)}`);
  }
  if (r.status >= 300) throw new Error(`vSphere SOAP request failed (HTTP ${r.status})`);
  const set = r.headers && r.headers['set-cookie'];
  if (set && set.length) { const c = set.map((x) => x.split(';')[0]).find((x) => /^vmware_soap_session=/i.test(x)); if (c) ctx.cookie = c; }
  return text;
}

/** vim25 API version the host speaks (newest listed), used in the SOAPAction header. */
async function apiVersion(base, verifySsl) {
  try { const v = await requestJson(`${base}/sdk/vimServiceVersions.xml`, { verifySsl, timeoutMs: 8000 }); const m = String(v.text || '').match(/<name>urn:vim25<\/name>\s*<version>([0-9.]+)<\/version>/); if (m) return m[1]; } catch { /* use the default below */ }
  return '6.0';
}

/** Signs in. Resolves to a context for the other calls. */
async function open(server, password) {
  const ctx = { base: `https://${server.host}`, verifySsl: server.verify_ssl, cookie: null, version: '6.0' };
  ctx.version = await apiVersion(ctx.base, ctx.verifySsl);
  const sc = await call(ctx, '<RetrieveServiceContent xmlns="urn:vim25"><_this type="ServiceInstance">ServiceInstance</_this></RetrieveServiceContent>');
  const moid = (tag) => { const m = sc.match(new RegExp(`<${tag} type="[^"]+">([^<]+)</${tag}>`)); return m ? m[1] : null; };
  ctx.sessionManager = moid('sessionManager'); ctx.propertyCollector = moid('propertyCollector'); ctx.viewManager = moid('viewManager'); ctx.rootFolder = moid('rootFolder');
  const about = sc.match(/<fullName>([^<]*)<\/fullName>/); ctx.fullName = about ? unesc(about[1]) : null;
  if (!ctx.sessionManager || !ctx.propertyCollector || !ctx.viewManager || !ctx.rootFolder) throw new Error('The host did not return the vSphere service content');
  await call(ctx, `<Login xmlns="urn:vim25"><_this type="SessionManager">${esc(ctx.sessionManager)}</_this><userName>${esc(server.username)}</userName><password>${esc(password)}</password></Login>`);
  return ctx;
}

async function close(ctx) { try { await call(ctx, `<Logout xmlns="urn:vim25"><_this type="SessionManager">${esc(ctx.sessionManager)}</_this></Logout>`); } catch { /* best effort */ } }

/** Property values of every object of `type` below the root folder: [{ moid, props: { 'path': { text, xml } } }]. */
async function retrieve(ctx, type, paths) {
  const view = (await call(ctx, `<CreateContainerView xmlns="urn:vim25"><_this type="ViewManager">${esc(ctx.viewManager)}</_this><container type="Folder">${esc(ctx.rootFolder)}</container><type>${type}</type><recursive>true</recursive></CreateContainerView>`))
    .match(/<returnval type="ContainerView">([^<]+)<\/returnval>/);
  if (!view) throw new Error('Could not list the inventory (no container view)');
  const out = [];
  try {
    let xml = await call(ctx, `<RetrievePropertiesEx xmlns="urn:vim25"><_this type="PropertyCollector">${esc(ctx.propertyCollector)}</_this><specSet><propSet><type>${type}</type><all>false</all>${paths.map((p) => `<pathSet>${p}</pathSet>`).join('')}</propSet>`
      + `<objectSet><obj type="ContainerView">${esc(view[1])}</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>traverseView</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet></specSet><options><maxObjects>100</maxObjects></options></RetrievePropertiesEx>`);
    for (let guard = 0; guard < 500; guard++) {
      for (const o of xml.matchAll(/<objects>([\s\S]*?)<\/objects>/g)) {
        const id = o[1].match(/<obj type="[^"]+">([^<]+)<\/obj>/);
        if (!id) continue;
        const props = {};
        for (const p of o[1].matchAll(/<propSet><name>([^<]+)<\/name><val([^>]*)>([\s\S]*?)<\/val><\/propSet>/g)) props[p[1]] = { attrs: p[2], xml: p[3], text: unesc(p[3]) };
        out.push({ moid: id[1], props });
      }
      const token = xml.match(/<token>([^<]+)<\/token>/);
      if (!token) break;
      xml = await call(ctx, `<ContinueRetrievePropertiesEx xmlns="urn:vim25"><_this type="PropertyCollector">${esc(ctx.propertyCollector)}</_this><token>${token[1]}</token></ContinueRetrievePropertiesEx>`);
    }
  } finally {
    call(ctx, `<DestroyView xmlns="urn:vim25"><_this type="ContainerView">${esc(view[1])}</_this></DestroyView>`).catch(() => {});
  }
  return out;
}

const numOrNull = (p) => { const n = p && parseInt(p.text, 10); return Number.isFinite(n) ? n : null; };
const POWER = { poweredOn: 'POWERED_ON', poweredOff: 'POWERED_OFF', suspended: 'SUSPENDED' };   // the same words the REST path stores

/** { vms, hosts } in the shape the discovery code stores. */
async function fetchInventory(server, password) {
  const ctx = await open(server, password);
  try {
    const hostObjs = await retrieve(ctx, 'HostSystem', ['name', 'runtime.connectionState', 'runtime.powerState']);
    const hostName = new Map(hostObjs.map((h) => [h.moid, h.props.name ? h.props.name.text : null]));
    const dcs = await retrieve(ctx, 'Datacenter', ['name']);
    const datacenter = dcs.length === 1 && dcs[0].props.name ? dcs[0].props.name.text : null;   // one datacenter (always the case on a standalone host)
    const vmObjs = await retrieve(ctx, 'VirtualMachine', ['name', 'runtime.powerState', 'runtime.host', 'guest.ipAddress', 'guest.guestFullName', 'guest.toolsStatus', 'config.guestFullName',
      'config.hardware.numCPU', 'config.hardware.memoryMB', 'config.hardware.device', 'snapshot.rootSnapshotList', 'config.template']);
    const vms = vmObjs.filter((v) => !(v.props['config.template'] && v.props['config.template'].text === 'true')).map((v) => {
      const p = v.props; const dev = p['config.hardware.device'] ? p['config.hardware.device'].xml : '';
      const macs = [...new Set([...dev.matchAll(/<macAddress>([^<]+)<\/macAddress>/g)].map((m) => m[1].toLowerCase()))];
      const ip = p['guest.ipAddress'] && p['guest.ipAddress'].text;
      const hostRef = p['runtime.host'] ? p['runtime.host'].text.trim() : null;
      const os = (p['guest.guestFullName'] && p['guest.guestFullName'].text) || (p['config.guestFullName'] && p['config.guestFullName'].text) || null;
      const snaps = p['snapshot.rootSnapshotList'] ? (p['snapshot.rootSnapshotList'].xml.match(/<snapshot type="VirtualMachineSnapshot"/g) || []).length : 0;
      return {
        moid: v.moid, name: p.name ? p.name.text : v.moid, power_state: p['runtime.powerState'] ? POWER[p['runtime.powerState'].text] || p['runtime.powerState'].text : null,
        ip_address: ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null, mac_addresses: macs, guest_os: os,
        cpu_count: numOrNull(p['config.hardware.numCPU']), memory_mb: numOrNull(p['config.hardware.memoryMB']),
        host_name: hostRef ? hostName.get(hostRef) || null : null, cluster: null, datacenter, folder: null,
        tools_status: p['guest.toolsStatus'] ? p['guest.toolsStatus'].text : null, snapshot_count: snaps,
      };
    });
    const hosts = hostObjs.map((h) => ({ moid: h.moid, name: h.props.name ? h.props.name.text : h.moid,
      state: (h.props['runtime.connectionState'] && h.props['runtime.connectionState'].text) || (h.props['runtime.powerState'] && h.props['runtime.powerState'].text) || null, cluster: null, datacenter }));
    return { vms, hosts, about: ctx.fullName };
  } finally { await close(ctx); }
}

/** Sign in and out only. Resolves to the product name, e.g. "VMware ESXi 6.7.0 build-14320388". */
async function test(server, password) { const ctx = await open(server, password); const name = ctx.fullName; await close(ctx); return name; }

module.exports = { fetchInventory, test, esc, unesc };
