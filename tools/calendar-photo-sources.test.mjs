import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { consumeSelectedCalendarImage } from '../src/features/calendar/calendarPhotoSelection.js';

const [calendarSource, calendarStyles] = await Promise.all([
  readFile(new URL('../src/features/calendar/Calendar.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/calendar/calendar.css', import.meta.url), 'utf8'),
]);

function inputWithId(id) {
  return calendarSource.match(new RegExp(`<input[^>]*id="${id}"[^>]*/>`))?.[0] || '';
}

test('schedule scanner exposes distinct camera and saved-picture actions', () => {
  assert.match(calendarSource, />Take photo</);
  assert.match(calendarSource, />Import picture</);
  assert.match(calendarSource, /aria-expanded=\{scanSourceOpen\}/);
  assert.match(calendarSource, /aria-controls="cal-scan-sources"/);
  assert.match(calendarSource, /role="group" aria-labelledby="cal-scan-sources-label"/);
  assert.match(calendarSource, /event\.detail === 0/);
  assert.match(calendarSource, /firstScanSource\.current\?\.focus\(\)/);
  assert.match(calendarSource, /event\.key !== 'Escape'/);
  assert.match(calendarSource, /closeOnOutsidePress/);
});

test('camera capture and image import remain separate while sharing one handler', () => {
  const cameraInput = inputWithId('cal-camera-input');
  const photoInput = inputWithId('cal-photo-input');

  assert.match(cameraInput, /accept="image\/\*"/);
  assert.match(cameraInput, /capture="environment"/);
  assert.match(photoInput, /accept="image\/\*"/);
  assert.doesNotMatch(photoInput, /\scapture=/);
  assert.match(cameraInput, /onChange=\{handleSchedulePhotoChange\}/);
  assert.match(photoInput, /onChange=\{handleSchedulePhotoChange\}/);
});

test('selected image consumption supports retrying the same file', () => {
  const selected = { name: 'schedule.png', type: 'image/png' };
  const input = { files: [selected], value: 'C:\\fakepath\\schedule.png' };

  assert.equal(consumeSelectedCalendarImage(input), selected);
  assert.equal(input.value, '');

  const emptyInput = { files: [], value: '' };
  assert.equal(consumeSelectedCalendarImage(emptyInput), null);
  assert.equal(emptyInput.value, '');
});

test('source choices stay touch-friendly and enter normal flow on smaller screens', () => {
  assert.match(calendarStyles, /\.cal-scan-source\s*\{[\s\S]*?min-height:\s*68px/);
  assert.match(calendarStyles, /@media \(max-width: 900px\)[\s\S]*?\.cal-scan-sources\s*\{[\s\S]*?position:\s*static/);
  assert.match(calendarStyles, /@media \(max-width: 380px\)[\s\S]*?grid-template-columns:\s*1fr/);
});
