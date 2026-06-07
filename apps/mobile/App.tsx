import React, { useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, ActivityIndicator, View, StyleSheet } from 'react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';

import { CitizenReportScreen } from './src/screens/CitizenReportScreen.js';
import { AlertsScreen } from './src/screens/AlertsScreen.js';
import { BeneficiaryRegistrationScreen } from './src/screens/BeneficiaryRegistrationScreen.js';
import { QRScanScreen } from './src/screens/QRScanScreen.js';
import { SyncStatusScreen } from './src/screens/SyncStatusScreen.js';
import { SettingsScreen } from './src/screens/SettingsScreen.js';
import { LoginScreen } from './src/screens/LoginScreen.js';
import { MapScreen } from './src/screens/MapScreen.js';
import { ProfileScreen } from './src/screens/ProfileScreen.js';
import { AppSettingsProvider } from './src/context/AppSettingsContext.js';
import { AuthProvider, useAuth } from './src/context/AuthContext.js';
import { setupNotificationListeners, registerPushToken, type RootTabParamList } from './src/notifications/index.js';
import { api } from './src/lib/api.js';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Tab       = createBottomTabNavigator<RootTabParamList>();
const Stack     = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>{icon}</Text>;
}

function RegistryStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#7f1d1d' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen
        name="BeneficiaryRegistration"
        component={BeneficiaryRegistrationScreen}
        options={{ title: 'Enregistrer un bénéficiaire' }}
      />
      <Stack.Screen
        name="QRScan"
        component={QRScanScreen}
        options={{ title: 'Scanner QR — Distribution' }}
      />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#7f1d1d' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: '#b91c1c',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: { borderTopColor: '#f3f4f6', elevation: 8 },
      }}
    >
      <Tab.Screen
        name="Alertes"
        component={AlertsScreen}
        options={{
          title: 'SINAUR-RDC',
          tabBarLabel: 'Alertes',
          tabBarIcon: ({ focused }) => <TabIcon icon="⚠️" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Carte"
        component={MapScreen}
        options={{
          title: 'Carte des événements',
          tabBarLabel: 'Carte',
          tabBarIcon: ({ focused }) => <TabIcon icon="🗺️" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Signaler"
        component={CitizenReportScreen}
        options={{
          title: 'Signaler un événement',
          tabBarLabel: 'Signaler',
          tabBarIcon: ({ focused }) => <TabIcon icon="📢" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Registre"
        component={RegistryStack}
        options={{
          headerShown: false,
          tabBarLabel: 'Registre',
          tabBarIcon: ({ focused }) => <TabIcon icon="👥" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Sync"
        component={SyncStatusScreen}
        options={{
          title: 'Synchronisation',
          tabBarLabel: 'Sync',
          tabBarIcon: ({ focused }) => <TabIcon icon="🔄" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Parametres"
        component={SettingsScreen}
        options={{
          title: 'Paramètres',
          tabBarLabel: 'Réglages',
          tabBarIcon: ({ focused }) => <TabIcon icon="⚙️" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Profil"
        component={ProfileScreen}
        options={{
          title: 'Mon profil',
          tabBarLabel: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const notifCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    notifCleanupRef.current = setupNotificationListeners(navigationRef);
    return () => { notifCleanupRef.current?.(); };
  }, []);

  // Enregistrer le push token dès la connexion
  useEffect(() => {
    if (isAuthenticated && user) {
      void registerPushToken(async (token) => {
        await api.post('/sync/register', {
          deviceId: user.sub,
          platform: 'android',
          pushToken: token,
          locationScope: user.scope ?? [],
        }).catch(() => {});
      });
    }
  }, [isAuthenticated, user]);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashIcon}>🛡️</Text>
        <ActivityIndicator color="#fca5a5" style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
      </AuthStack.Navigator>
    );
  }

  return <MainTabs />;
}

export default function App() {
  return (
    <AppSettingsProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef}>
          <StatusBar style="light" backgroundColor="#7f1d1d" />
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </AppSettingsProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7f1d1d' },
  splashIcon: { fontSize: 64 },
});
