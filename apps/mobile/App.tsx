import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { CitizenReportScreen } from './src/screens/CitizenReportScreen.js';
import { AlertsScreen } from './src/screens/AlertsScreen.js';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Tab = createBottomTabNavigator();

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>{icon}</Text>
  );
}

export default function App() {
  useEffect(() => {
    // Demander la permission push notifications
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
      </Tab.Navigator>
    </NavigationContainer>
  );
}
