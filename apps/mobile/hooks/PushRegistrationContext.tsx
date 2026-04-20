import * as Notifications from 'expo-notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  ForegroundBanner,
  type BannerContent,
} from '@/components/ForegroundBanner';
import {
  usePushRegistration,
  type PushRegistrationState,
} from '@/hooks/usePushRegistration';

// Expo notifications requires the handler to be registered once at module load
// so the OS knows how to surface notifications arriving while the app is active.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const PushRegistrationContext =
  createContext<PushRegistrationState | null>(null);

export function PushRegistrationProvider({ children }: { children: ReactNode }) {
  const state = usePushRegistration();
  const [banner, setBanner] = useState<BannerContent | null>(null);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      setBanner({
        title: content.title ?? 'T816 bus',
        body: content.body ?? '',
      });
    });
    return () => {
      sub.remove();
    };
  }, []);

  const dismiss = useCallback(() => setBanner(null), []);

  return (
    <PushRegistrationContext.Provider value={state}>
      {children}
      <ForegroundBanner banner={banner} onDismiss={dismiss} />
    </PushRegistrationContext.Provider>
  );
}

/**
 * Access the current push-registration state anywhere under
 * `<PushRegistrationProvider>`. Returns a read-only snapshot with permission
 * status, token (when granted), last registered timestamp, and last error.
 */
export function usePushRegistrationState(): PushRegistrationState {
  const ctx = useContext(PushRegistrationContext);
  if (!ctx) {
    throw new Error(
      'usePushRegistrationState must be used within <PushRegistrationProvider>',
    );
  }
  return ctx;
}
