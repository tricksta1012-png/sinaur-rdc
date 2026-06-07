/**
 * Utilitaires geohash pour les requêtes géospatiales de proximité.
 * Utilisés en complément de PostGIS côté serveur.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let bits = 0, bitsTotal = 0, hashValue = 0;

  while (hash.length < precision) {
    if (bitsTotal % 2 === 0) {
      const mid = (minLng + maxLng) / 2;
      if (lng > mid) { hashValue = (hashValue << 1) + 1; minLng = mid; }
      else            { hashValue = (hashValue << 1) + 0; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat > mid) { hashValue = (hashValue << 1) + 1; minLat = mid; }
      else            { hashValue = (hashValue << 1) + 0; maxLat = mid; }
    }
    bits++;
    bitsTotal++;
    if (bits === 5) {
      hash += BASE32[hashValue]!;
      bits = 0;
      hashValue = 0;
    }
  }
  return hash;
}

export function decodeGeohash(hash: string): { lat: number; lng: number } {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let isLng = true;

  for (const char of hash) {
    const code = BASE32.indexOf(char);
    for (let b = 4; b >= 0; b--) {
      const bit = (code >> b) & 1;
      if (isLng) {
        const mid = (minLng + maxLng) / 2;
        if (bit) minLng = mid; else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bit) minLat = mid; else maxLat = mid;
      }
      isLng = !isLng;
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}
