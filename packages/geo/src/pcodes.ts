import type { AdminLevel, LocationReference } from '@sinaur/shared-types';

export function getPcodeLevel(pcode: string): AdminLevel {
  if (pcode === 'COD') return 0;
  if (/^CD\d{2}$/.test(pcode)) return 1;
  if (/^CD\d{4}$/.test(pcode)) return 2;
  if (/^CD\d{6}$/.test(pcode)) return 3;
  if (/^CD\d{8}$/.test(pcode)) return 4;
  if (/^CD\d{10}$/.test(pcode)) return 5;
  return 6;
}

export function getProvincePcode(pcode: string): string {
  if (pcode === 'COD') return 'COD';
  const match = pcode.match(/^(CD\d{2})/);
  return match?.[1] ?? pcode;
}

export function isWithinScope(pcode: string, scopePcodes: string[]): boolean {
  if (scopePcodes.length === 0) return true;
  return scopePcodes.some((s) => pcode.startsWith(s) || s.startsWith(pcode));
}

export function buildLocationReference(
  pcode: string,
  name: string,
  lat?: number,
  lng?: number,
): LocationReference {
  return {
    pcode,
    name,
    level: getPcodeLevel(pcode),
    coordinates: lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined,
    accuracy: lat !== undefined ? 'gps' : 'pcode',
  };
}
