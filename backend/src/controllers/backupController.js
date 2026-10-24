const svc = require('../services/backupService');
const { audit } = require('../services/auditService');
const { bad } = require('../utils/httpError');

exports.tables = async (req, res) => res.json({ tables: svc.CSV_TABLES, restorable: svc.RESTORABLE, schedule: await svc.getSchedule(), history: await svc.history() });
exports.csvTable = async (req, res) => {
  const csv = await svc.tableCsv(req.params.table);
  audit(req, 'backup_csv_download', 'backup', req.params.table);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.table}.csv"`);
  res.send(csv);
};
exports.run = async (req, res) => {
  const kind = req.body.kind;
  if (!['pg_dump', 'csv'].includes(kind)) throw bad('kind must be pg_dump or csv');
  const rec = kind === 'pg_dump' ? await svc.createPgDump(req.user.email) : await svc.createCsvSet(req.user.email);
  audit(req, 'backup', 'backup', rec.id, { kind, status: rec.status });
  res.status(rec.status === 'ok' ? 201 : 500).json(rec);
};
exports.restoreUpload = async (req, res) => {
  if (!req.file) throw bad('Attach a CSV file in the "file" field');
  const inserted = await svc.restoreTable(req.params.table, await svc.parseCsv(req.file.buffer));
  audit(req, 'restore', 'backup', req.params.table, { inserted });
  res.json({ table: req.params.table, inserted });
};
exports.restoreHistory = async (req, res) => { const r = await svc.restoreFromHistory(req.params.id); audit(req, 'restore', 'backup', req.params.id, r); res.json(r); };
exports.putSchedule = async (req, res) => res.json(await svc.saveSchedule(req.body));
