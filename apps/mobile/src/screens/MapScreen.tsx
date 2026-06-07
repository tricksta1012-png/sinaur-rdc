import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import MapView, { Marker, Callout, UrlTile, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '../lib/api.js';
import { useOfflineSync } from '../hooks/useOfflineSync.js';
import type { DisasterEvent } from '@sinaur/shared-types';

const SEVERITY_COLORS: Record<string, string> = {
  Extreme: '#7f1d1d',
  Severe:  '#ef4444',
  Moderate:'#f97316',
  Minor:   '#fbbf24',
  Unknown: '#9ca3af',
};

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃', conflict: '⚔️',
  health_epidemic: '🦠', drought: '☀️', fire: '🔥', earthquake: '📳', other: '⚠️',
};

const HAZARD_FILTERS = ['Tous', 'flood', 'conflict', 'health_epidemic', 'displacement', 'drought'];
const FILTER_LABELS: Record<string, string> = {
  Tous: 'Tous', flood: '🌊 Inond.', conflict: '⚔️ Conflit',
  health_epidemic: '🦠 Épidémie', displacement: '🏃 Déplacés', drought: '☀️ Sécheresse',
};

// Centre de la RDC
const RDC_CENTER: Region = {
  latitude: -4.0383,
  longitude: 21.7587,
  latitudeDelta: 12,
  longitudeDelta: 12,
};

export function MapScreen() {
  const [events, setEvents]       = useState<DisasterEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('Tous');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const mapRef = useRef<MapView>(null);
  const { isOnline } = useOfflineSync();

  useEffect(() => {
    void fetchEvents();
    void requestLocation();
  }, []);

  const fetchEvents = async () => {
    try {
      const { data } = await api.get<{ data: DisasterEvent[] }>('/events?limit=100&page=1&status=active');
      setEvents(data.data ?? []);
    } catch {
      // Hors ligne — carte vide
    } finally {
      setLoading(false);
    }
  };

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch {}
  };

  const centerOnUser = () => {
    if (userLocation) {
      mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 1, longitudeDelta: 1 }, 800);
    }
  };

  const filteredEvents = events.filter(e => {
    if (filter === 'Tous') return true;
    if (filter === 'displacement') return e.hazardType === 'mass_displacement';
    return e.hazardType === filter;
  }).filter(e => e.latitude != null && e.longitude != null);

  return (
    <View style={styles.container}>
      {/* Filtres */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterList}>
          {HAZARD_FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {FILTER_LABELS[f] ?? f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Carte */}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#b91c1c" />
          <Text style={styles.loaderText}>Chargement de la carte...</Text>
        </View>
      ) : (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={RDC_CENTER}
          showsUserLocation={userLocation != null}
          showsMyLocationButton={false}
        >
          {/* Tuiles OpenStreetMap */}
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
            tileSize={256}
          />

          {/* Marqueurs événements */}
          {filteredEvents.map(event => (
            <Marker
              key={event.id}
              coordinate={{ latitude: event.latitude!, longitude: event.longitude! }}
              pinColor={SEVERITY_COLORS[event.severity] ?? '#9ca3af'}
            >
              <View style={[styles.markerPin, { backgroundColor: SEVERITY_COLORS[event.severity] ?? '#9ca3af' }]}>
                <Text style={styles.markerIcon}>{HAZARD_ICONS[event.hazardType] ?? '⚠️'}</Text>
              </View>
              <Callout tooltip>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle} numberOfLines={2}>{event.title}</Text>
                  <Text style={styles.calloutLocation}>{event.locationName}</Text>
                  <View style={[styles.calloutBadge, { backgroundColor: SEVERITY_COLORS[event.severity] ?? '#9ca3af' }]}>
                    <Text style={styles.calloutBadgeText}>{event.severity}</Text>
                  </View>
                  {event.estimatedAffected != null && (
                    <Text style={styles.calloutAffected}>
                      👥 ~{event.estimatedAffected.toLocaleString('fr-FR')} pers.
                    </Text>
                  )}
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      )}

      {/* Boutons flottants */}
      <View style={styles.fab}>
        {userLocation && (
          <TouchableOpacity style={styles.fabBtn} onPress={centerOnUser} activeOpacity={0.8}>
            <Text style={styles.fabIcon}>📍</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.fabBtn, { marginTop: 8 }]} onPress={() => void fetchEvents()} activeOpacity={0.8}>
          <Text style={styles.fabIcon}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Hors ligne */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Hors ligne — données non actualisées</Text>
        </View>
      )}

      {/* Légende */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>{filteredEvents.length} événement{filteredEvents.length !== 1 ? 's' : ''}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1 },
  filterBar:         { backgroundColor: '#fff', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', zIndex: 10 },
  filterList:        { paddingHorizontal: 12, gap: 8 },
  filterChip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  filterChipActive:  { backgroundColor: '#7f1d1d', borderColor: '#7f1d1d' },
  filterText:        { fontSize: 13, color: '#374151', fontWeight: '500' },
  filterTextActive:  { color: '#fff' },
  map:               { flex: 1 },
  loader:            { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText:        { fontSize: 14, color: '#9ca3af' },
  markerPin:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3 },
  markerIcon:        { fontSize: 18 },
  callout:           { backgroundColor: '#fff', borderRadius: 12, padding: 12, minWidth: 180, maxWidth: 240, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },
  calloutTitle:      { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 4 },
  calloutLocation:   { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  calloutBadge:      { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginBottom: 6 },
  calloutBadgeText:  { fontSize: 11, color: '#fff', fontWeight: '700' },
  calloutAffected:   { fontSize: 12, color: '#374151' },
  fab:               { position: 'absolute', right: 16, bottom: Platform.OS === 'ios' ? 32 : 20 },
  fabBtn:            { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4 },
  fabIcon:           { fontSize: 20 },
  offlineBanner:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#92400e', paddingVertical: 6, alignItems: 'center' },
  offlineText:       { fontSize: 12, color: '#fff', fontWeight: '500' },
  legend:            { position: 'absolute', top: Platform.OS === 'ios' ? 12 : 8, right: 12, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, elevation: 3 },
  legendTitle:       { fontSize: 12, color: '#374151', fontWeight: '600' },
});
