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
check(admin.includes("document.getElementById('rep-from')"), 'reports must initialize a start-date filter');
check(admin.includes("document.getElementById('rep-to')"), 'reports must initialize an end-date filter');
check(admin.includes('repFromInput.value = firstDay'), 'reports must default to the first day of the current month');
check(admin.includes('repToInput.value   = lastDay'), 'reports must default to the real last day of the current month');

const employee = fs.readFileSync('employee.html', 'utf8');
check(employee.includes('if (teamSel.value) onLoginTeamChange();'), 'fallback login must populate employees for a selected team');
check(employee.includes('id="sup-manual-detail"'), 'supervisor manual task flow must include the dependent task detail select');
check(employee.includes('TaskCatalog.composeDescription'), 'employee reports must store the selected task detail');

const taskCatalog = fs.readFileSync('task-catalog.js', 'utf8');
let loadedTaskCatalog;
try {
  const script = new vm.Script(taskCatalog, { filename: 'task-catalog.js' });
  const sandbox = { window: {} };
  script.runInNewContext(sandbox);
  loadedTaskCatalog = sandbox.window.TaskCatalog;
} catch (error) {
  failed = true;
  console.error(error.stack);
}
const catalogTypes = ['البنك','المشتريات','المبيعات','الموردين','العملاء','التقارير','الإقرارات','الميزانية','عام'];
catalogTypes.forEach(type => check(taskCatalog.includes(`'${type}'`), `task catalog must include ${type}`));
check(loadedTaskCatalog?.types.length === 9, 'task catalog must expose exactly nine task types');
check(Object.values(loadedTaskCatalog?.catalog || {}).flat().length === 75, 'task catalog must expose all 75 approved task details');
check(loadedTaskCatalog?.catalog['عام']?.includes('إعداد أو تسجيل مسير رواتب'), 'general tasks must include payroll preparation or entry');
check(loadedTaskCatalog?.requiresNotes('مهمة أخرى') === true, 'other tasks must require a description');
check(loadedTaskCatalog?.requiresNotes('إعداد أو تسجيل مسير رواتب') === false, 'known general tasks must keep notes optional');
check(!admin.includes('id="task-subtab-normal-btn"'), 'urgent task creation tab must be removed');
check(!admin.includes('id="tasks-normal-container"'), 'urgent task creation form must be removed');
check(!admin.includes('انشاء مهمه طارئه'), 'urgent task creation label must be removed');
check(admin.includes('id="tasks-recurring-container"'), 'recurring task management must remain available');
check(admin.includes('id="rec-task-detail"'), 'recurring task form must include the dependent task detail select');

try {
  new vm.Script(fs.readFileSync('guard.js', 'utf8'), { filename: 'guard.js' });
} catch (error) {
  failed = true;
  console.error(error.stack);
}

if (failed) process.exit(1);
console.log('Smoke checks passed.');
