import fs from 'node:fs';
import vm from 'node:vm';

const htmlFiles = ['admin.html', 'employee.html'];
let failed = false;

function check(condition, message) {
  if (condition) return;
  failed = true;
  console.error(`FAIL: ${message}`);
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  check(/^<!DOCTYPE html>/i.test(html), `${file} must start with a valid HTML doctype`);
  check(!html.includes('@supabase/supabase-js@2"'), `${file} must pin the Supabase client version`);

  const scripts = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let inlineCount = 0;
  while ((match = scripts.exec(html))) {
    const attributes = match[1];
    const body = match[2];
    if (/\bsrc\s*=/i.test(attributes)) {
      check(body.trim() === '', `${file} has inline code inside an external script tag`);
      continue;
    }

    inlineCount += 1;
    try {
      new vm.Script(body, { filename: `${file}:inline-${inlineCount}` });
    } catch (error) {
      failed = true;
      console.error(error.stack);
    }
  }
  check(inlineCount === 1, `${file} should contain one application script`);
}

const admin = fs.readFileSync('admin.html', 'utf8');
check(!/localStorage\.setItem\(['"]nuzum_password/.test(admin), 'admin password must not be stored in localStorage');
check(admin.includes('async function exploreClientDetails()'), 'client explorer must fetch data asynchronously');
check(admin.includes('async function exportEmployeeProfileExcel()'), 'employee export must fetch fresh data');
check(!admin.includes('`${month}-31`'), 'month ranges must use the real final day');

const employee = fs.readFileSync('employee.html', 'utf8');
check(employee.includes('if (teamSel.value) onLoginTeamChange();'), 'fallback login must populate employees for a selected team');

try {
  new vm.Script(fs.readFileSync('guard.js', 'utf8'), { filename: 'guard.js' });
} catch (error) {
  failed = true;
  console.error(error.stack);
}

if (failed) process.exit(1);
console.log('Smoke checks passed.');
