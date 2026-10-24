const { makeScheduler, discoverAll } = require('./schedulerFactory');
const vmware = require('./vmwareService');
module.exports = makeScheduler('vmware', () => discoverAll('vmware_servers', vmware.discover));
module.exports.runAll = () => discoverAll('vmware_servers', vmware.discover);
