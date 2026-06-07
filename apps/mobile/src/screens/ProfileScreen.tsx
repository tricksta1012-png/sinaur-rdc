import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';

const ROLE_LABELS: Record<string, string> = {
  citizen:                 'Citoyen',
  field_agent:             'Agent terrain',
  local_validator:         'Validateur local',
  territory_admin:         'Admin territoire',
  humanitarian_partner:    'Partenaire humanitaire',
  national_decision_maker: 'Décideur national',
  system_admin:            'Administrateur système',
};

interface Profile {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: string;
  geographicScopePcodes: string[];
  lastLoginAt: string | null;
}

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const [profile, setProfile]     = useState<Profile | null>(null);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone]         = useState('');

  useEffect(() => {
    void fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await api.get<{ success: boolean; data: Profile }>('/users/me');
      const p = res.data.data;
      setProfile(p);
      setDisplayName(p.displayName);
      setPhone(p.phone ?? '');
    } catch {
      Alert.alert('Erreur', 'Impossible de charger le profil.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch<{ success: boolean; data: Profile }>('/users/me', {
        displayName: displayName.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setProfile(res.data.data);
      setEditing(false);
    } catch {
      Alert.alert('Erreur', 'La mise à jour a échoué.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Déconnexion',
      'Voulez-vous vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Déconnexion', style: 'destructive', onPress: logout },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#b91c1c" size="large" />
      </View>
    );
  }

  const roleLabel = ROLE_LABELS[profile?.role ?? ''] ?? profile?.role;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar */}
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.displayName ?? '?')[0].toUpperCase()}
          </Text>
        </View>
        <View style={styles.avatarInfo}>
          <Text style={styles.displayName}>{profile?.displayName}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel}</Text>
          </View>
        </View>
      </View>

      {/* Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>INFORMATIONS</Text>
        <View style={styles.card}>
          <Row label="Email" value={profile?.email ?? '—'} />
          <Row label="Téléphone" value={profile?.phone ?? '—'} />
          <Row
            label="Périmètre"
            value={
              profile?.geographicScopePcodes?.length
                ? profile.geographicScopePcodes.join(', ')
                : 'National'
            }
          />
          <Row
            label="Dernière connexion"
            value={
              profile?.lastLoginAt
                ? new Date(profile.lastLoginAt).toLocaleDateString('fr-FR', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })
                : '—'
            }
            last
          />
        </View>
      </View>

      {/* Édition */}
      {!editing ? (
        <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
          <Text style={styles.editBtnText}>Modifier mon profil</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MODIFIER</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Nom affiché</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Votre nom"
              placeholderTextColor="#9ca3af"
            />
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Téléphone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+243 …"
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
            />
          </View>
          <View style={styles.editActions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => { setEditing(false); setDisplayName(profile?.displayName ?? ''); setPhone(profile?.phone ?? ''); }}
            >
              <Text style={styles.btnGhostText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnPrimaryText}>Enregistrer</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Déconnexion */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </TouchableOpacity>
        <Text style={styles.version}>SINAUR-RDC v0.13.0</Text>
      </View>
    </ScrollView>
  );
}

function Row({
  label, value, last,
}: {
  label: string; value: string; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f9fafb' },
  content:      { padding: 16, paddingBottom: 40 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },

  avatarRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  avatar:       { width: 64, height: 64, borderRadius: 32, backgroundColor: '#7f1d1d', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText:   { color: '#fff', fontSize: 28, fontWeight: '700' },
  avatarInfo:   { flex: 1 },
  displayName:  { fontSize: 18, fontWeight: '700', color: '#111827' },
  roleBadge:    { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#fee2e2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  roleText:     { fontSize: 12, color: '#991b1b', fontWeight: '600' },

  section:      { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' },

  card:         { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowLast:      { borderBottomWidth: 0 },
  rowLabel:     { fontSize: 13, color: '#6b7280', fontWeight: '500', flex: 1 },
  rowValue:     { fontSize: 13, color: '#111827', fontWeight: '500', flex: 2, textAlign: 'right' },

  editBtn:      { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db', paddingVertical: 13, alignItems: 'center', marginBottom: 20 },
  editBtnText:  { fontSize: 14, fontWeight: '600', color: '#374151' },

  fieldLabel:   { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 4, paddingHorizontal: 2 },
  input:        { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: '#111827' },

  editActions:  { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn:          { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnGhost:     { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  btnGhostText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  btnPrimary:   { backgroundColor: '#b91c1c' },
  btnPrimaryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  btnDisabled:  { opacity: 0.5 },

  logoutBtn:    { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#fca5a5', paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  logoutText:   { fontSize: 14, fontWeight: '600', color: '#dc2626' },
  version:      { textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 4 },
});
