import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { api } from '../lib/api.js';
import { useOfflineSync } from '../hooks/useOfflineSync.js';
import type { DisasterEvent } from '@sinaur/shared-types';

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};
const SEVERITY_COLORS: Record<string, string> = {
  Minor: '#fbbf24', Moderate: '#f97316', Severe: '#ef4444', Extreme: '#7f1d1d', Unknown: '#9ca3af',
};
const SEVERITY_FR: Record<string, string> = {
  Minor: 'Mineur', Moderate: 'Modéré', Severe: 'Sévère', Extreme: 'Extrême', Unknown: 'Inconnu',
};

function EventCard({ item }: { item: DisasterEvent }) {
  const severityColor = SEVERITY_COLORS[item.severity] ?? '#9ca3af';
  return (
    <View style={[styles.card, item.severity === 'Extreme' && styles.cardExtreme]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>{HAZARD_ICONS[item.hazardType] ?? '⚠️'}</Text>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.cardLocation}>{item.locationName}</Text>
        </View>
        <View style={[styles.severityBadge, { backgroundColor: severityColor }]}>
          <Text style={styles.severityText}>{SEVERITY_FR[item.severity] ?? item.severity}</Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.cardDate}>
          {new Date(item.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
        </Text>
        {item.estimatedAffected && (
          <Text style={styles.cardAffected}>👥 ~{item.estimatedAffected.toLocaleString('fr-FR')} pers.</Text>
        )}
      </View>
    </View>
  );
}

export function AlertsScreen() {
  const [events, setEvents] = useState<DisasterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { isOnline, pendingCount } = useOfflineSync();

  const fetchEvents = async () => {
    try {
      const { data } = await api.get<{ data: DisasterEvent[] }>('/events?limit=30&page=1');
      setEvents(data.data ?? []);
    } catch {
      // Données en cache (lecture offline non implémentée ici — Phase 4)
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void fetchEvents(); }, []);

  return (
    <View style={styles.container}>
      {/* Barre de statut */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#f97316' }]} />
        <Text style={styles.statusText}>{isOnline ? 'Connecté' : 'Hors ligne'}</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount} en attente</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#b91c1c" />
          <Text style={styles.loadingText}>Chargement des alertes...</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EventCard item={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void fetchEvents(); }} colors={['#b91c1c']} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🛡️</Text>
              <Text style={styles.emptyText}>Aucun événement actif</Text>
              <Text style={styles.emptySubText}>Toutes les zones sont calmes</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  pendingBadge: { marginLeft: 'auto', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pendingText: { fontSize: 11, color: '#92400e', fontWeight: '600' },
  list: { padding: 12, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e5e7eb', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  cardExtreme: { borderColor: '#fca5a5', borderWidth: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIcon: { fontSize: 28, marginTop: 2 },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#111827', lineHeight: 20 },
  cardLocation: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  severityText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  cardDate: { fontSize: 12, color: '#9ca3af' },
  cardAffected: { fontSize: 12, color: '#374151', fontWeight: '500' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#9ca3af' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptySubText: { fontSize: 13, color: '#9ca3af' },
});
