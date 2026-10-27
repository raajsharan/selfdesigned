const db = require('../config/db');
const { unionSql } = require('../utils/inventoryUnion');
const { bad } = require('../utils/httpError');

const format = (r, n) => `${r.prefix}${String(n).padStart(r.pad, '0')}`;

async function getRange(department) {
  if (!department) return null;
  const { rows } = await db.query('SELECT * FROM department_tag_ranges WHERE department = $1 AND is_active', [department]);
  return rows[0] || null;
}

/** If the department has a range, the tag must be prefix + a number inside it. */
async function validateTag(department, tag) {
  const range = await getRange(department);
  if (!range || !tag) return;
  const rest = tag.startsWith(range.prefix) ? tag.slice(range.prefix.length) : null;
  const n = rest !== null && /^\d+$/.test(rest) ? parseInt(rest, 10) : NaN;
  if (Number.isNaN(n) || n < range.range_start || n > range.range_end) {
    throw bad(`Asset tag for ${department} must be ${format(range, range.range_start)} to ${format(range, range.range_end)}`);
  }
}

async function nextFreeTags(department, count = 1, client = db) {
  const range = await getRange(department);
  if (!range) throw bad(`No tag range configured for department "${department}"`);
  const { rows } = await client.query(
    `SELECT asset_tag FROM (${unionSql('asset_tag', "asset_tag IS NOT NULL AND asset_tag <> '' AND is_deleted = FALSE")}) t WHERE asset_tag LIKE $1`,
    [range.prefix.replace(/[%_\\]/g, '\\$&') + '%']);
  const used = new Set(rows.map((r) => r.asset_tag));
  const out = [];
  for (let n = range.range_start; n <= range.range_end && out.length < count; n++) {
    const t = format(range, n);
    if (!used.has(t)) out.push(t);
  }
  if (out.length < count) throw bad(`Tag range for ${department} is exhausted`);
  return out;
}

module.exports = { validateTag, nextFreeTags, getRange };
