// Small admin lookups: dropdowns, server models, tag ranges, branding, field config, audit, teams.
const db = require('../config/db');
const simpleCrud = require('../utils/simpleCrud');
const { getSetting, setSetting } = require('../services/settingsService');
const teams = require('../services/teamsNotificationService');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');

exports.tagRanges = simpleCrud({ table: 'department_tag_ranges', entity: 'tag_range', cols: ['department', 'prefix', 'range_start', 'range_end', 'pad'],
  orderBy: 'department', label: (r) => r.department });
const dropdownCrud = simpleCrud({ table: 'dropdown_values', entity: 'dropdown', cols: ['category', 'value', 'sort_order', 'parent_value'],
  orderBy: 'category, sort_order, value', label: (r) => `${r.category}: ${r.value}` });
exports.dropdownCrud = dropdownCrud;

/**
 * { category: [values], $parents: { category: { value: parentValue } } } for forms; every logged-in user may read it.
 * "$parents" only lists values that belong to a value of another list (dependent dropdowns).
 */
exports.dropdownsMap = async (req, res) => {
  const { rows } = await db.query('SELECT category, value, parent_value FROM dropdown_values ORDER BY category, sort_order, value');
  const out = {}; const parents = {};
  rows.forEach((r) => {
    (out[r.category] ||= []).push(r.value);
    if (r.parent_value) (parents[r.category] ||= {})[r.value] = r.parent_value;
  });
  out.$parents = parents;
  res.json(out);
};


// ---- Branding (public read so the login page can be themed) ---------------------------
const BRANDING_DEFAULT = { app_name: 'Inventory Tool', primary_color: '#1f6f78', logo_data_url: null };
exports.getBranding = async (req, res) => res.json(await getSetting('branding', BRANDING_DEFAULT));
exports.putBranding = async (req, res) => {
  const { app_name, primary_color, logo_data_url } = req.body;
  if (primary_color && !/^#[0-9a-fA-F]{6}$/.test(primary_color)) throw bad('Colour must be a hex value like #1f6f78');
  // Raster images only: SVG can carry script.
  if (logo_data_url && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo_data_url)) throw bad('Logo must be a PNG, JPEG or WebP image');
  if (logo_data_url && logo_data_url.length > 700000) throw bad('Logo is too large (max ~500 KB)');
  const v = { app_name: String(app_name || BRANDING_DEFAULT.app_name).slice(0, 64), primary_color: primary_color || BRANDING_DEFAULT.primary_color, logo_data_url: logo_data_url || null };
  await setSetting('branding', v);
  audit(req, 'update', 'branding', null, { app_name: v.app_name });
  res.json(v);
};

// ---- Teams ---------------------------------------------------------------------------
exports.getTeams = async (req, res) => res.json(await teams.getConfig());
exports.putTeams = async (req, res) => { const out = await teams.saveConfig(req.body); audit(req, 'update', 'teams_notification', null, { enabled: out.enabled }); res.json(out); };
exports.testTeams = async (req, res) => { await teams.sendTest(); res.json({ ok: true }); };

// ---- Audit log -----------------------------------------------------------------------
exports.auditList = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, parseInt(req.query.pageSize, 10) || 50);
  const p = []; const w = ['TRUE'];
  if (req.query.action) { p.push(req.query.action); w.push(`action = $${p.length}`); }
  if (req.query.entity) { p.push(req.query.entity); w.push(`entity = $${p.length}`); }
  if (req.query.q) { p.push(`%${req.query.q}%`); w.push(`(user_email ILIKE $${p.length} OR details::text ILIKE $${p.length})`); }
  const total = (await db.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE ${w.join(' AND ')}`, p)).rows[0].n;
  const { rows } = await db.query(`SELECT * FROM audit_logs WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p);
  res.json({ rows, total, page, pageSize });
};
