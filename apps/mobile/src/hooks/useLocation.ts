import { useState } from 'react';
import * as Location from 'expo-location';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function useLocation() {
  const [location, setLocation] = useState<GpsLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = async (): Promise<GpsLocation | null> => {
    setLoading(true);
    setError(null);

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setError('Permission de localisation refusée. Sélectionnez votre zone manuellement.');
      setLoading(false);
      return null;
    }

    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const gps: GpsLocation = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 0,
      };
      setLocation(gps);
      setLoading(false);
      return gps;
    } catch {
      setError('Impossible d\'obtenir la position GPS. Vérifiez que le GPS est activé.');
      setLoading(false);
      return null;
    }
  };

  return { location, loading, error, requestLocation };
}
