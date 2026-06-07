import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext.js';

export function LoginScreen() {
  const { login, loginWithBiometric, biometricAvailable, isLoading } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Veuillez remplir tous les champs.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      if (status === 401 || status === 400) {
        setError('Email ou mot de passe incorrect.');
      } else if (status >= 500) {
        setError('Serveur indisponible. Vérifiez votre connexion.');
      } else {
        setError('Connexion impossible. Réessayez plus tard.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    try {
      await loginWithBiometric();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('expirée')) {
        Alert.alert('Session expirée', 'Veuillez vous reconnecter avec vos identifiants.');
      }
    }
  };

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashIcon}>🛡️</Text>
        <Text style={styles.splashTitle}>SINAUR-RDC</Text>
        <ActivityIndicator color="#b91c1c" style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* En-tête */}
        <View style={styles.header}>
          <Text style={styles.logo}>🛡️</Text>
          <Text style={styles.title}>SINAUR-RDC</Text>
          <Text style={styles.subtitle}>Système national d'alerte et d'urgence</Text>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>République Démocratique du Congo</Text>
        </View>

        {/* Formulaire */}
        <View style={styles.form}>
          {error !== '' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.label}>Adresse e-mail</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="agent@sinaur-rdc.cd"
            placeholderTextColor="#9ca3af"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            returnKeyType="next"
          />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#9ca3af"
            secureTextEntry
            editable={!loading}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={[styles.btnLogin, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnLoginText}>Se connecter</Text>
            }
          </TouchableOpacity>

          {biometricAvailable && (
            <TouchableOpacity
              style={styles.btnBiometric}
              onPress={handleBiometric}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.btnBiometricText}>
                {Platform.OS === 'ios' ? '🔒 Face ID / Touch ID' : '🔒 Déverrouiller par empreinte'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          Sans accès réseau : *777*SINAUR# (USSD)
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7f1d1d' },
  splashIcon: { fontSize: 64 },
  splashTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 12 },
  container: { flexGrow: 1, backgroundColor: '#fff', paddingBottom: 32 },
  header: { backgroundColor: '#7f1d1d', paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40, alignItems: 'center' },
  logo: { fontSize: 56 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 12 },
  subtitle: { fontSize: 14, color: '#fca5a5', marginTop: 4, textAlign: 'center' },
  divider: { width: 40, height: 2, backgroundColor: '#fca5a5', marginVertical: 16, borderRadius: 1 },
  dividerText: { fontSize: 12, color: '#fecaca', fontWeight: '500' },
  form: { paddingHorizontal: 24, paddingTop: 32, gap: 6 },
  errorBox: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  errorText: { fontSize: 13, color: '#b91c1c', fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 14, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb' },
  btnLogin: { backgroundColor: '#b91c1c', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  btnDisabled: { backgroundColor: '#9ca3af' },
  btnLoginText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnBiometric: { borderWidth: 1.5, borderColor: '#b91c1c', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 10 },
  btnBiometricText: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 32, paddingHorizontal: 24 },
});
