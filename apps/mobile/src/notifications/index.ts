/**
 * Gestionnaire de notifications push FCM/Expo.
 * Enregistre les listeners de réception et de réponse (tap).
 * La navigation est pilotée via navigationRef.
 */
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RefObject } from 'react';

export type RootTabParamList = {
  Alertes: undefined;
  Signaler: undefined;
  Registre: undefined;
  Carte: undefined;
  Sync: undefined;
  Parametres: undefined;
};

type NotificationData = {
  type?: 'NEW_EVENT' | 'NEW_ALERT' | 'SYNC_CONFLICT' | 'CRISIS_CREATED' | string;
  resourceId?: string;
  severity?: string;
};

function handleNotificationNavigation(
  navRef: RefObject<NavigationContainerRef<RootTabParamList>>,
  data: NotificationData,
) {
  const nav = navRef.current;
  if (!nav?.isReady()) return;

  switch (data.type) {
    case 'NEW_EVENT':
    case 'NEW_ALERT':
    case 'CRISIS_CREATED':
      nav.navigate('Alertes');
      break;
    case 'SYNC_CONFLICT':
      nav.navigate('Sync');
      break;
    default:
      nav.navigate('Alertes');
  }
}

export function setupNotificationListeners(
  navRef: RefObject<NavigationContainerRef<RootTabParamList>>,
): () => void {
  // Notification reçue en foreground
  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as NotificationData;
    // En foreground : afficher une bannière dans l'app si sévérité Extreme
    if (data.severity === 'Extreme') {
      // L'affichage est géré par le handler global (shouldShowAlert: true)
    }
  });

  // Tap sur la notification (foreground ou background)
  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as NotificationData;
    handleNotificationNavigation(navRef, data);
  });

  return () => {
    Notifications.removeNotificationSubscription(receivedSub);
    Notifications.removeNotificationSubscription(responseSub);
  };
}

export async function registerPushToken(
  postFn: (token: string) => Promise<void>,
): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    await postFn(tokenData.data);
  } catch {
    // Non-bloquant — la notification push est optionnelle
  }
}
