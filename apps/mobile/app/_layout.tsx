import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import '../global.css';

import { PushRegistrationProvider } from '@/hooks/PushRegistrationContext';
import { useRealtimeRoutes } from '@/hooks/useRealtimeRoutes';
import { useQuickActions } from '@/hooks/useQuickActions';
import { SettingsProvider, useSettings } from '@/hooks/useSettings';
import { StaticGtfsProvider } from '@/hooks/useStaticGtfs';
import { TransitNetworkProvider } from '@/hooks/useTransitNetwork';
import { PlannerProvider } from '@/state/PlannerContext';
import { RideProvider } from '@/state/RideContext';
import { TripProvider } from '@/state/TripContext';
import { color, itineraryDetents, SHEET_INITIAL_DETENT, sheetDetents } from '@/theme/design';
import { configureNotifications } from '@/services/reminders/notifications';
// Background tasks must be defined at module scope so iOS can run them on a
// headless launch (commute re-plan, arrival geofence).
import '@/services/reminders/backgroundRefresh';
import '@/services/arrival/geofence';
// Static GTFS zips download through expo/fetch (no base64 body decode in JS).
import '@/services/staticFetch';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();
configureNotifications();

// Deep links (e.g. the Live Activity's t816://) always land with the map at
// the root of the stack, so sheets have something to sit on and return to.
export const unstable_settings = { initialRouteName: 'index' };

// Calm Mono: every sheet is opaque paper. Text never sits on glass over a
// busy (or satellite) map, so contrast holds at every detent.
const SHEET_BACKGROUND = color.paper;

/**
 * One map-backed screen with a persistent trip sheet (Apple Maps / Find My
 * pattern) — no tab bar. See docs/design/README.md §2.
 */
export default function RootLayout() {
  return (
    <SettingsProvider>
      <StaticGtfsProvider>
        <TransitNetworkProvider>
          <RealtimeRoutesRunner />
          <PushRegistrationProvider>
            <TripProvider>
              <PlannerProvider>
                <RideProvider>
                  <AppStack />
                </RideProvider>
              </PlannerProvider>
            </TripProvider>
          </PushRegistrationProvider>
        </TransitNetworkProvider>
      </StaticGtfsProvider>
    </SettingsProvider>
  );
}

function AppStack() {
  const colorScheme = useColorScheme();
  const { ready } = useSettings();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const detents = sheetDetents(windowHeight, insets.top);
  useQuickActions();

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
            sheetAllowedDetents: detents,
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
          name="plan"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            title: 'Where to?',
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="itinerary"
          options={{
            presentation: 'formSheet',
            // Its peek covers the trip peek exactly (the trip is pinned there).
            sheetAllowedDetents: itineraryDetents(windowHeight, insets.top),
            sheetInitialDetentIndex: 1,
            sheetLargestUndimmedDetentIndex: 1,
            sheetGrabberVisible: true,
            headerShown: false,
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="ride"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            title: 'Where are you getting off?',
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="stops"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6, 1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="warnings"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            title: 'Heads-up',
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="departure"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="station"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.5, 1],
            sheetGrabberVisible: true,
            // The focused map stays visible and usable at 0.5.
            sheetLargestUndimmedDetentIndex: 0,
            headerShown: true,
            headerTransparent: true,
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        <Stack.Screen
          name="line"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6, 1],
            sheetGrabberVisible: true,
            // The line on the map stays visible and usable at 0.6.
            sheetLargestUndimmedDetentIndex: 0,
            headerShown: true,
            headerTransparent: true,
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
        {/* Temporary (plan 12/00): network build timing harness. */}
        <Stack.Screen
          name="dev-network"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            contentStyle: { backgroundColor: SHEET_BACKGROUND },
          }}
        />
        {/* Temporary (plan 14/00): planner timing harness. */}
        <Stack.Screen
          name="dev-planner"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
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
