import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import '../global.css';

import { bootstrapStaticGtfs } from '@/db/bootstrap';
import { PushRegistrationProvider } from '@/hooks/PushRegistrationContext';
import { SettingsProvider } from '@/hooks/useSettings';
import { tokens } from '@/theme/tokens';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    bootstrapStaticGtfs().catch((err) => {
      console.warn('[gtfs] bootstrap failed', err);
    });
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <SettingsProvider>
      <PushRegistrationProvider>
        <NativeTabs
          tintColor={tokens.color.accent}
          labelStyle={{ fontSize: 11 }}
          minimizeBehavior="onScrollDown"
        >
          <NativeTabs.Trigger name="index">
            <NativeTabs.Trigger.Icon sf="tram.fill" />
            <NativeTabs.Trigger.Label>Tracker</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="map">
            <NativeTabs.Trigger.Icon sf="map.fill" />
            <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="settings">
            <NativeTabs.Trigger.Icon sf="gear" />
            <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        </NativeTabs>
      </PushRegistrationProvider>
    </SettingsProvider>
  );
}
