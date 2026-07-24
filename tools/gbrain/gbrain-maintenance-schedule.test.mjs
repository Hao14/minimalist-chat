import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(directory, 'Install-GBrainMaintenanceTask.ps1');
const runner = path.join(directory, 'Run-GBrainScheduledMaintenance.ps1');

test('scheduled-maintenance preview is hidden, limited, and side-effect free', () => {
  const execution = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', installer,
    '-DryRun',
    '-DayOfWeek', 'Tuesday',
    '-At', '04:15',
    '-TaskName', 'GBrain Test Preview Only',
  ], { encoding: 'utf8', shell: false, windowsHide: true });

  assert.equal(execution.status, 0, execution.stderr);
  const preview = JSON.parse(execution.stdout.replace(/^\uFEFF/, ''));
  assert.equal(preview.action, 'install_gbrain_maintenance_task');
  assert.equal(preview.day_of_week, 'Tuesday');
  assert.equal(preview.at, '04:15');
  assert.equal(preview.logon_type, 'Interactive');
  assert.equal(preview.run_level, 'Limited');
  assert.match(preview.executable, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(path.isAbsolute(preview.executable), true);
  assert.match(preview.arguments, /-WindowStyle Hidden/);
  assert.match(preview.arguments, new RegExp(runner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('PowerShell accepts both maintenance scripts without executing them', () => {
  const command = [installer, runner]
    .map((file) => `[void][scriptblock]::Create((Get-Content -Raw -LiteralPath '${file.replaceAll("'", "''")}'))`)
    .join('; ');
  const execution = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8', shell: false, windowsHide: true,
  });
  assert.equal(execution.status, 0, execution.stderr);
});
