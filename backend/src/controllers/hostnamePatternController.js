// Hostname naming pattern: drives the "Suggested hostname" panel on record forms.
const db = require('../config/db');
const { getSetting, setSetting } = require('../services/settingsService');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');
const svc = require('../services/pageService');
const rename = require('../services/hostnameRenameService');

const SEGMENTS = ['site', 'os', 'team', 'tier', 'tag'];
const DEFAULTS = {
  order: SEGMENTS, type_field: 'asset_type', types: ['VM', 'ESXi', 'Desktop', 'Physical Server', 'Bare Metal Server'], sites: {},
  suggest_pages: null,                 // null = every records page with a Hostname field; otherwise the page slugs
  rename_pages: [],                    // pages whose form may apply the hostname to the host with Ansible
  tier_field: '', allow_reboot: true, login_user_fields: '', login_pass_fields: '',   // blank = find the login fields on the page automatically
  teams: [['ITO', 'IT Team'], ['LAB', 'Lab Team'], ['QAT', 'QA Team'], ['DEV', 'Development Team'], ['DVO', 'Dev-Ops Team'], ['SNP', 'Support and Service Team'],
    ['PLT', 'Platform Team'], ['SEC', 'Application Security Team'], ['PSE', 'Pre-Sales Engineer Team'], ['NEA', 'Network Engineering Automation Team']].map(([code, label]) => ({ code, label })),
  tiers: [['P', 'Production'], ['S', 'Staging'], ['D', 'Development'], ['T', 'Testing'], ['C', 'Customer-facing'], ['G', 'General Purpose']].map(([code, label]) => ({ code, label })),
};
const slugs = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((s) => /^[a-z][a-z0-9-]{1,47}$/.test(s)))] : null);
const CODE_RE = /^[A-Za-z0-9]{1,8}$/;

async function load() {
  const cfg = await getSetting('hostname_pattern', DEFAULTS);
  const { rows } = await db.query("SELECT value FROM dropdown_values WHERE category = 'location' ORDER BY sort_order, value");
  const pages = (await svc.listPages()).filter((p) => p.kind === 'records').map((p) => ({ slug: p.slug, title: p.title }));
  return { ...cfg, locations: rows.map((r) => r.value), pages };
}
exports.renameJob = (req, res) => res.json(rename.getJob(req));
exports.get = async (req, res) => res.json(await load());

function codeList(list, what) {
  if (!Array.isArray(list) || list.length > 200) throw bad(`${what} must be a list`);
  const seen = new Set();
  return list.map((x) => {
    const code = String(x.code || '').trim().toUpperCase(); const label = String(x.label || '').trim().slice(0, 120);
    if (!CODE_RE.test(code)) throw bad(`${what}: "${x.code}" is not a valid code (letters and digits, up to 8)`);
    if (seen.has(code)) throw bad(`${what}: the code ${code} is used twice`);
    seen.add(code); return { code, label: label || code };
  });
}

exports.put = async (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.order) || b.order.length !== SEGMENTS.length || !SEGMENTS.every((s) => b.order.includes(s))) throw bad('The pattern must contain Site, OS, Team, Tier and Asset Tag once each');
  const typeField = String(b.type_field || '').trim();
  if (typeField && !/^[a-z][a-z0-9_]{0,40}$/.test(typeField)) throw bad('Asset type field key must be lower-case letters, digits or underscores');
  const sites = {};
  for (const [loc, code] of Object.entries(b.sites || {})) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) continue;
    if (!CODE_RE.test(c)) throw bad(`Site code for ${loc} must be letters and digits, up to 8`);
    sites[String(loc).slice(0, 128)] = c;
  }
  const value = { order: b.order, type_field: typeField, types: (Array.isArray(b.types) ? b.types : []).map((t) => String(t).trim().slice(0, 120)).filter(Boolean).slice(0, 100),
    suggest_pages: slugs(b.suggest_pages), rename_pages: slugs(b.rename_pages) || [], allow_reboot: b.allow_reboot !== false,
    tier_field: /^[a-z][a-z0-9_]{0,40}$/.test(String(b.tier_field || '')) ? String(b.tier_field) : '',
    login_user_fields: String(b.login_user_fields || '').trim().slice(0, 200), login_pass_fields: String(b.login_pass_fields || '').trim().slice(0, 200),
    sites, teams: codeList(b.teams, 'Team codes'), tiers: codeList(b.tiers, 'Tier codes') };
  await setSetting('hostname_pattern', value);
  audit(req, 'update', 'hostname_pattern', null, { name: 'Hostname naming pattern' });
  res.json(await load());
};

/** Add a location to the shared Location list (Dropdown Master "location") so it can get a site code. */
exports.addLocation = async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 255);
  if (!name) throw bad('Enter a location name');
  await db.query("INSERT INTO dropdown_values (category, value, sort_order) VALUES ('location', $1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM dropdown_values WHERE category = 'location')) ON CONFLICT DO NOTHING", [name]);
  audit(req, 'create', 'dropdown', null, { name: `location: ${name}` });
  res.json(await load());
};
