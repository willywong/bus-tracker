import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  usePathname,
} from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { DynamicColorIOS, Platform, useColorScheme } from 'react-native';
import 'react-native-reanimated';
import '../global.css';

import { PushRegistrationProvider } from '@/hooks/PushRegistrationContext';
import { useRealtimeRoutes } from '@/hooks/useRealtimeRoutes';
import { SettingsProvider } from '@/hooks/useSettings';
import { StaticGtfsProvider } from '@/hooks/useStaticGtfs';
import { tokens } from '@/theme/tokens';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
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

  if (!loaded) {
    return null;
  }

  const tabTintColor =
    Platform.OS === 'ios'
      ? DynamicColorIOS({ light: tokens.color.accent, dark: '#64D2FF' })
      : tokens.color.accent;
  const hidesTabsForToolbarDemo =
    pathname === '/liquid-glass-demo/stack-toolbar';

  return (
    <SettingsProvider>
      <StaticGtfsProvider>
        <RealtimeRoutesRunner />
        <PushRegistrationProvider>
          <ThemeProvider
            value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}
          >
            <NativeTabs
              hidden={hidesTabsForToolbarDemo}
              tintColor={tabTintColor}
              labelStyle={{ fontSize: 11 }}
              minimizeBehavior="onScrollDown"
            >
              <NativeTabs.Trigger name="(tracker)">
                <NativeTabs.Trigger.Icon sf="tram.fill" md="directions_bus" />
                <NativeTabs.Trigger.Label>Tracker</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger name="map">
                <NativeTabs.Trigger.Icon sf="map.fill" md="map" />
                <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger name="liquid-glass-demo">
                <NativeTabs.Trigger.Icon
                  sf="sparkles"
                  md="auto_awesome"
                />
                <NativeTabs.Trigger.Label>Glass</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
              <NativeTabs.Trigger name="settings">
                <NativeTabs.Trigger.Icon sf="gear" md="settings" />
                <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
              </NativeTabs.Trigger>
            </NativeTabs>
          </ThemeProvider>
        </PushRegistrationProvider>
      </StaticGtfsProvider>
    </SettingsProvider>
  );
}

function RealtimeRoutesRunner() {
  useRealtimeRoutes();
  return null;
}
