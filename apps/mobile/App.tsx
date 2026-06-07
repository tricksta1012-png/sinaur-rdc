import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { CitizenReportScreen } from './src/screens/CitizenReportScreen.js';
import { AlertsScreen } from './src/screens/AlertsScreen.js';
import { BeneficiaryRegistrationScreen } from './src/screens/BeneficiaryRegistrationScreen.js';
import { QRScanScreen } from './src/screens/QRScanScreen.js';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>{icon}</Text>
  );
}

// Stack pour le module Registre (enregistrement + QR scan)
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

export default function App() {
  useEffect(() => {
    void Notifications.requestPermissionsAsync();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor="#7f1d1d" />
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
      </Tab.Navigator>
    </NavigationContainer>
  );
}
