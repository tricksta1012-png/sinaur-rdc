import type { MapRef } from 'react-map-gl/maplibre';

export function whenMapReady(mapRef: MapRef): Promise<void> {
  return new Promise((resolve) => {
    const map = mapRef.getMap();
    if (map.isStyleLoaded() && map.loaded()) {
      resolve();
    } else {
      map.once('idle', () => resolve());
    }
  });
}
