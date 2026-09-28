import assert from 'node:assert/strict';
import {
  isValidScheduleTimeZone,
  getStoreLocalDateKey,
  storeDateKeyToUtcIso,
  storeTodayDateKey,
  storeLocalDateTimeToUtcIso,
  utcIsoToStoreLocalDateTime,
} from './schedule-timezone';

assert.equal(isValidScheduleTimeZone('America/Sao_Paulo'), true);
assert.equal(isValidScheduleTimeZone('Not/A_Timezone'), false);
assert.equal(
  storeLocalDateTimeToUtcIso('2026-09-28T09:00', 'America/Sao_Paulo'),
  '2026-09-28T12:00:00.000Z',
);
assert.equal(
  utcIsoToStoreLocalDateTime('2026-09-28T12:00:00.000Z', 'America/Sao_Paulo'),
  '2026-09-28T09:00',
);
assert.equal(storeLocalDateTimeToUtcIso('2026-09-28T09:00', null), null);
assert.equal(
  storeLocalDateTimeToUtcIso('2026-01-15T09:00', 'America/New_York'),
  '2026-01-15T14:00:00.000Z',
);
assert.equal(
  storeLocalDateTimeToUtcIso('2026-07-15T09:00', 'America/New_York'),
  '2026-07-15T13:00:00.000Z',
);
assert.equal(storeLocalDateTimeToUtcIso('2026-03-08T02:30', 'America/New_York'), null);
assert.equal(storeLocalDateTimeToUtcIso('2026-11-01T01:30', 'America/New_York'), null);
assert.equal(
  utcIsoToStoreLocalDateTime('2026-07-15T13:00:00.000Z', 'America/New_York'),
  '2026-07-15T09:00',
);
assert.equal(getStoreLocalDateKey('2026-01-01T02:00:00.000Z', 'America/Sao_Paulo'), '2025-12-31');
assert.equal(storeDateKeyToUtcIso('2026-01-15', 'America/New_York'), '2026-01-15T05:00:00.000Z');
assert.equal(storeTodayDateKey('America/New_York', new Date('2026-01-01T02:00:00.000Z')), '2025-12-31');
