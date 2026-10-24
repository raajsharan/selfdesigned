// Browser test of the page designer: designs pages by clicking and dragging, then uses them.
//   cd e2e && npm install playwright && npx playwright install chromium
//   BASE_URL=http://localhost:4000 TEST_EMAIL=... TEST_PASSWORD=... node designer.mjs
// Run against a FRESH, throw-away database: it asserts that no pages exist at the start and creates pages named
// "Servers", "Laptops" and "All records".
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const EMAIL = process.env.TEST_EMAIL; const PASSWORD = process.env.TEST_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Set TEST_EMAIL and TEST_PASSWORD (a superadmin or admin).'); process.exit(2); }
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let reqs = 0; page.on('request', (r) => { if (r.url().includes('/api/vmware/servers')) reqs++; });
const bad = []; page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${extra}`);
const pick = async (selectLoc, optionText) => { await selectLoc.click(); await page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: optionText }).first().click(); };

process.on('uncaughtException', async (e) => { console.log('FAILED:', String(e.message).split('\n')[0]); await page.screenshot({ path: 'fail.png' }).catch(()=>{}); console.log(await page.locator('.field-card').allInnerTexts().catch(()=>[])); process.exit(1); });
await page.goto(BASE + '/login');
await page.fill('input[type=text], input[id*=email]', EMAIL); await page.fill('input[type=password]', PASSWORD); await page.click('button[type=submit]');
await page.waitForSelector('.ant-layout-sider');

// 0. nothing is built in
const menu = (await page.locator('.ant-menu').innerText());
step('fresh install has no built-in inventory pages', !/Asset Inventory|Beijing|Ext\. Asset|Physical/.test(menu) && !menu.includes('PAGES'));
step('dashboard invites you to design pages', await page.locator('text=No pages yet').count() === 1);

// 1. create a records page
await page.goto(BASE + '/admin/pages', { waitUntil: 'networkidle' });
await page.click('button:has-text("New page")');
await page.fill('.ant-modal input#title', 'Servers');
step('address auto-fills from the title', (await page.inputValue('.ant-modal input#slug')) === 'servers');
await page.click('.ant-modal button:has-text("Create and design")');
await page.waitForURL('**/admin/pages/servers');

// 2. fields
const addField = async (label, { role, type, required } = {}) => {
  await page.click('button:has-text("Add field")');
  const card = page.locator('.field-card').last();
  await card.locator('label:has-text("Label") input').fill(label);
  if (type) await pick(card.locator('label:has-text("Type") .ant-select'), type);
  if (role) await pick(card.locator('label:has-text("Meaning") .ant-select'), role);
  if (required) await card.locator('.ant-checkbox-wrapper:has-text("Required")').click();
  await card.locator('.field-card-head').click();       // collapse
};
await addField('Server name', { role: 'Name' });
await addField('IP address', { role: 'IP address' });
await addField('MAC address', { role: 'MAC address', required: true });
await addField('Status', { type: 'Choice list', role: 'Status' });
// the Status field needs custom options
await page.locator('.field-card', { hasText: 'Status' }).locator('.field-card-head b').first().click();
const opt = page.locator('.field-card-body label:has-text("Custom list")').first();
const tags = page.locator('.field-card-body .ant-select-multiple input');
await tags.click(); await tags.fill('Active'); await tags.press('Enter'); await tags.fill('Retired'); await tags.press('Enter'); await page.keyboard.press('Escape');
step('options typed into the choice list', (await page.locator('.field-card-body .ant-select-multiple .ant-select-selection-item').allInnerTexts()).join(',') === 'Active,Retired');
await page.locator('.field-card', { hasText: 'Status' }).locator('.field-card-head b').first().click();
step('key is generated from the label', await page.locator('.field-card', { hasText: 'server_name' }).count() === 1);
step('tab shows 4 fields', await page.locator('.ant-tabs-tab:has-text("Fields (4)")').count() === 1);

// 3. form layout with real drag-and-drop
await page.click('.ant-tabs-tab:has-text("Form layout")');
step('required field not on form is flagged', await page.locator('text=Required but not on the form').count() === 1);
await page.click('button:has-text("Add section")');
await page.locator('.canvas-section input').first().fill('Identity');
await page.click('button:has-text("Place all remaining fields")');
step('"Place all" puts every field on the form', await page.locator('.canvas-item').count() === 4 && await page.locator('text=Required but not on the form').count() === 0);
// remove one with its button, then drag it back from the palette into the section
await page.locator('.canvas-item', { hasText: 'IP address' }).locator('button[aria-label^="Remove"]').click();
step('removed field returns to the palette', await page.locator('.designer-pane .chip', { hasText: 'IP address' }).count() === 1);
await page.locator('.designer-pane .chip', { hasText: 'IP address' }).dragTo(page.locator('.canvas-item', { hasText: 'Server name' }));
step('drag from palette onto a field inserts it before that field', (await page.locator('.canvas-item').allInnerTexts()).map((t) => t.split('\n')[0].trim())[0].startsWith('IP address'));
// reorder by dragging within the canvas
await page.locator('.canvas-item', { hasText: 'Status' }).dragTo(page.locator('.canvas-item', { hasText: 'IP address' }));
step('drag within the canvas reorders', (await page.locator('.canvas-item').allInnerTexts())[0].startsWith('Status'));

await page.click('button:has-text("Preview form")');
step('form preview renders the designed fields', await page.locator('.ant-drawer label:has-text("MAC address")').count() === 1);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// 4. table layout with drag-and-drop
await page.click('.ant-tabs-tab:has-text("Table layout")');
await page.locator('.designer-pane .chip', { hasText: 'Server name' }).dragTo(page.locator('text=Drop here').first());
await page.locator('.designer-pane .chip', { hasText: 'IP address' }).dragTo(page.locator('text=Drop here').first());
await page.locator('.designer-pane .chip', { hasText: 'Status' }).dragTo(page.locator('text=Drop here').first());
step('three columns dragged into the table', await page.locator('.canvas-item b').count() === 3);
await page.locator('.canvas-item', { hasText: 'Status' }).dragTo(page.locator('.canvas-item', { hasText: 'Server name' }));
step('column drag reorders the table', (await page.locator('.canvas-item b').allInnerTexts())[0] === 'Status');


// 5. save
await page.click('button:has-text("Save layout")');
await page.waitForSelector('.ant-message-success');
step('layout saved', await page.locator('text=unsaved changes').count() === 0);
await page.reload({ waitUntil: 'networkidle' });
step('layout persists after reload', await page.locator('.ant-tabs-tab:has-text("Fields (4)")').count() === 1);
step('saved key is locked', await (async () => { await page.locator('.field-card-head b').first().click(); return page.locator('.field-card-body input.mono').first().isDisabled(); })());

// 6. the new page appears in the menu and works
await page.locator('a:has-text("Open page")').click();
await page.waitForSelector('.page-head h1:has-text("Servers")');
step('page appears in the menu', (await page.locator('.ant-menu').innerText()).includes('Servers'));
await page.click('button:has-text("Add record")');
await page.waitForSelector('.ant-drawer-content');
await page.fill('.ant-drawer #mac_address', 'bad');
await page.click('.ant-drawer button:has-text("Create")');
step('required + MAC format enforced in the designed form', await page.locator('.ant-form-item-explain-error').count() >= 1);
await page.fill('.ant-drawer #server_name', 'web-01'); await page.fill('.ant-drawer #ip_address', '10.20.30.40'); await page.fill('.ant-drawer #mac_address', 'aa-bb-cc-dd-ee-01');
await pick(page.locator('.ant-drawer .ant-form-item:has(#status) .ant-select'), 'Active');
await page.click('.ant-drawer button:has-text("Create")');
await page.waitForSelector('.ant-message-success'); await page.waitForTimeout(600);
step('record appears in the designed table', await page.locator('tbody td:has-text("web-01")').count() === 1 && await page.locator('tbody td:has-text("10.20.30.40")').count() === 1);
step('column order follows the design (Status first)', (await page.locator('thead th').allInnerTexts()).slice(1, 4).join('|').startsWith('Status'));

// 7. second page (via API) + "All records" view built in the UI
const tok = await page.evaluate(() => localStorage.getItem('inv_token'));
const api = (m, p, b) => fetch(BASE + '/api' + p, { method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
await api('POST', '/pages', { slug: 'laptops', title: 'Laptops', kind: 'records', config: {
  fields: [{ key: 'device', label: 'Device', type: 'text', role: 'name' }, { key: 'address', label: 'Address', type: 'text', role: 'ip' }],
  form: { sections: [{ id: 'a', title: '', columns: 1, items: [{ key: 'device' }, { key: 'address' }] }] }, table: { columns: [{ key: 'device' }, { key: 'address' }] } } });
const lap = await api('GET', '/pages/laptops');
await fetch(BASE + '/api/p/laptops/records', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ data: { device: 'laptop-77', address: '10.20.30.77' } }) });
await page.goto(BASE + '/admin/pages', { waitUntil: 'networkidle' });
await page.click('button:has-text("New page")');
await page.locator('.ant-modal .ant-radio-wrapper:has-text("View page")').click();
await page.fill('.ant-modal input#title', 'All records');
await page.click('.ant-modal button:has-text("Create and design")');
await page.waitForURL('**/admin/pages/all-records');
await page.locator('.ant-checkbox-wrapper:has-text("Servers")').click();
await page.locator('.ant-checkbox-wrapper:has-text("Laptops")').click();
await page.click('.ant-tabs-tab:has-text("Columns")');
await page.click('button:has-text("Build columns from field meanings")');
const cols = await page.locator('.canvas-item input[aria-label="Column title"]').evaluateAll((els) => els.map((e) => e.value));
step('view columns are built from field meanings', cols.includes('Name') && cols.includes('IP address') && cols.includes('MAC address'), JSON.stringify(cols));
await page.locator('.ant-checkbox-wrapper:has-text("Show which page each row comes from")').click();

await page.click('button:has-text("Save layout")'); await page.waitForSelector('.ant-message-success');
await page.goto(BASE + '/p/all-records', { waitUntil: 'networkidle' });
const body = await page.locator('tbody').innerText();
step('"All records" shows rows from both pages, matched across differently named fields', body.includes('web-01') && body.includes('laptop-77') && body.includes('10.20.30.40') && body.includes('10.20.30.77'));
step('each row says which page it came from', body.includes('Servers') && body.includes('Laptops'));
await page.locator('tbody tr', { hasText: 'laptop-77' }).click();
await page.waitForURL('**/p/laptops?record=*'); await page.waitForSelector('.ant-drawer-content');
step('clicking a combined row opens that record on its own page', await page.locator('.ant-drawer-content:has-text("laptop-77")').count() === 1);


// 8. latent loop check: the discovery Servers tab must not refetch endlessly
await page.goto(BASE + '/vmware', { waitUntil: 'networkidle' });
reqs = 0; await page.click('.ant-tabs-tab:has-text("Servers")'); await page.waitForTimeout(2500);
step('discovery Servers tab loads its data a bounded number of times', reqs > 0 && reqs <= 3, `(${reqs} requests)`);

console.log('\npage errors:', errs.length ? errs : 'none'); console.log('unexpected HTTP errors:', bad.length ? [...new Set(bad)] : 'none');
await browser.close();
