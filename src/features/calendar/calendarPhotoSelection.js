export function consumeSelectedCalendarImage(input) {
  const file = input?.files?.[0] || null;
  if (input) input.value = '';
  return file;
}
