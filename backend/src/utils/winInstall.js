// Builds Nessus Agent install commands from validated config values only - never from free-form input.
const { bad } = require('./httpError');

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;     // POSIX single-quote escaping
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;         // PowerShell single-quote escaping

function validate(cfg) {
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(cfg.manager_host || '')) throw bad('Nessus manager host is not set or invalid');
  if (!Number.isInteger(+cfg.manager_port) || +cfg.manager_port < 1 || +cfg.manager_port > 65535) throw bad('Nessus manager port is invalid');
  if (!/^[A-Za-z0-9]{16,128}$/.test(cfg.linking_key || '')) throw bad('Linking key is not set or invalid');
  if (cfg.groups && !/^[A-Za-z0-9 _.,-]{1,200}$/.test(cfg.groups)) throw bad('Agent groups contain unsupported characters');
}
function httpsUrl(u, label) {
  try { if (new URL(u).protocol !== 'https:') throw new Error(); } catch { throw bad(`${label} must be an https URL`); }
  return u;
}

function linuxInstall(cfg) {
  validate(cfg);
  const url = httpsUrl(cfg.linux_package_url, 'Linux package URL');
  const link = `/opt/nessus_agent/sbin/nessuscli agent link --key=${shq(cfg.linking_key)} --host=${shq(cfg.manager_host)} --port=${+cfg.manager_port}${cfg.groups ? ` --groups=${shq(cfg.groups)}` : ''}`;
  return `set -e; f=$(mktemp /tmp/nessusagent.XXXXXX); curl -fsSL -o "$f" ${shq(url)}; ` +
    `if command -v dpkg >/dev/null 2>&1; then sudo dpkg -i "$f"; else sudo rpm -Uvh "$f"; fi; rm -f "$f"; ` +
    `sudo ${link}; sudo systemctl enable --now nessusagent`;
}
function windowsInstall(cfg) {
  validate(cfg);
  const url = httpsUrl(cfg.windows_msi_url, 'Windows MSI URL');
  const cli = '"C:\\Program Files\\Tenable\\Nessus Agent\\nessuscli.exe"';
  const ps = `$ErrorActionPreference='Stop'; $m=Join-Path $env:TEMP 'nessusagent.msi'; Invoke-WebRequest -UseBasicParsing -Uri ${psq(url)} -OutFile $m; ` +
    `Start-Process msiexec.exe -ArgumentList '/i',$m,'/qn','/norestart' -Wait; Remove-Item $m -Force; ` +
    `& ${cli} agent link --key=${psq(cfg.linking_key)} --host=${psq(cfg.manager_host)} --port=${+cfg.manager_port}${cfg.groups ? ` --groups=${psq(cfg.groups)}` : ''}`;
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`;
}
const verifyCommand = (os) => (os === 'windows'
  ? 'powershell -NoProfile -NonInteractive -Command "& \'C:\\Program Files\\Tenable\\Nessus Agent\\nessuscli.exe\' -v"'
  : '/opt/nessus_agent/sbin/nessuscli -v');

module.exports = { linuxInstall, windowsInstall, verifyCommand };
