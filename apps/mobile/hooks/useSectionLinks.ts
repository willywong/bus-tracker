import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { isBareLink } from '@/components/rail/deepLink';
import { useSettings } from '@/hooks/useSettings';
import { useNearby } from '@/state/NearbyContext';

/**
 * The bus Live Activity opens bare `t816://`, which should land on your
 * bus's trip in Nearby whatever section or view you were last on. Rail links (`t816://station/…`,
 * `t816://line/…`) have a path, so they leave the section alone. Waits for
 * stored settings, or loading them would overwrite the choice. Never throws.
 */
export function useSectionLinks(): void {
  const { ready, setSheetSection } = useSettings();
  const { reset, push } = useNearby();
  const section = useRef(setSheetSection);
  section.current = setSheetSection;
  const view = useRef({ reset, push });
  view.current = { reset, push };

  useEffect(() => {
    if (!ready) return;
    const handle = (url: string | null | undefined) => {
      if (!url || !isBareLink(url)) return;
      section.current('nearby');
      view.current.reset();
      view.current.push({ kind: 'trip' });
    };
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [ready]);
}
