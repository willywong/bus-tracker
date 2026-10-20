import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { PlatformColor, Platform, useColorScheme } from 'react-native';
import 'react-native-reanimated';
import '../global.css';

import { isGlassAvailable } from '@/components/GlassGuard';
import { PushRegistrationProvider } from '@/hooks/PushRegistrationContext';
import { useRealtimeRoutes } from '@/hooks/useRealtimeRoutes';
import { SettingsProvider, useSettings } from '@/hooks/useSettings';
import { StaticGtfsProvider } from '@/hooks/useStaticGtfs';
import { TripProvider } from '@/state/TripContext';
import { SHEET_DETENTS, SHEET_INITIAL_DETENT } from '@/theme/design';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

// Deep links (e.g. the Live Activity's t816://) always land with the map at
// the root of the stack, so sheets have something to sit on and return to.
export const unstable_settings = { initialRouteName: 'index' };

// iOS 26 draws Liquid Glass behind a transparent sheet; older systems draw
// nothing, so give them the standard opaque sheet background instead.
const SHEET_BACKGROUND =
  Platform.OS === 'ios' && !isGlassAvailable()
    ? PlatformColor('systemBackground')
    : 'transparent';

/**
 * One map-backed screen with a persistent trip sheet (Apple Maps / Find My
 * pattern) — no tab bar. See docs/design/README.md §2.
 */
export default function RootLayout() {
  return (
    <SettingsProvider>
      <StaticGtfsProvider>
        <RealtimeRoutesRunner />
        <PushRegistrationProvider>
          <TripProvider>
            <AppStack />
          </TripProvider>
        </PushRegistrationProvider>
      </StaticGtfsProvider>
    </SettingsProvider>
  );
}

function AppStack() {
  const colorScheme = useColorScheme();
  const { ready } = useSettings();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="index"
          options={{ headerShown: true, headerTransparent: true, title: '' }}
        />
        <Stack.Screen
          name="trip"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [...SHEET_DETENTS],
            sheetInitialDetentIndex: SHEET_INITIAL_DETENT,
            // The map stays interactive behind the peek and glance detents.
            sheetLargestUndimmedDetentIndex: 1,
            sheetGrabberVisible: true,
            // Persistent: the sheet resizes but can't be swiped away.
            gestureEnabled: false,
            // Transparent on iOS 26 so the system draws the Liquid Glass sheet.
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="add-route"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            title: 'Add Route',
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            title: 'Settings',
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}

function RealtimeRoutesRunner() {
  useRealtimeRoutes();
  return null;
}
