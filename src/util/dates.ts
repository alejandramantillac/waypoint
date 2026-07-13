export function toLocalDay(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(s).getTime());
}

export function isParseableDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s));
}
