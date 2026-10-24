const { makeScheduler, discoverAll } = require('./schedulerFactory');
const proxmox = require('./proxmoxService');
module.exports = makeScheduler('proxmox', () => discoverAll('proxmox_servers', proxmox.discover));
module.exports.runAll = () => discoverAll('proxmox_servers', proxmox.discover);
