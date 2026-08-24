const mysqlUtcPattern = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)$/;

export function databaseDateToIso(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || '').trim();
  const mysqlUtc = mysqlUtcPattern.exec(text);
  const parsed = new Date(mysqlUtc ? `${mysqlUtc[1]}T${mysqlUtc[2]}Z` : text);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid database date.');
  return parsed.toISOString();
}

export function nullableDatabaseDateToIso(value) {
  return value == null || value === '' ? null : databaseDateToIso(value);
}
