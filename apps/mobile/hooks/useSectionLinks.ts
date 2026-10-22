import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { isBareLink } from '@/components/rail/deepLink';
import { useSettings } from '@/hooks/useSettings';

/**
 * The bus Live Activity opens bare `t816://`, which should land on Nearby
 * whatever section you were last on. Rail links (`t816://station/…`,
 * `t816://line/…`) have a path, so they leave the section alone. Waits for
 * stored settings, or loading them would overwrite the choice. Never throws.
 */
export function useSectionLinks(): void {
  const { ready, setSheetSection } = useSettings();
  const section = useRef(setSheetSection);
  section.current = setSheetSection;

  useEffect(() => {
    if (!ready) return;
    const handle = (url: string | null | undefined) => {
      if (url && isBareLink(url)) section.current('nearby');
    };
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [ready]);
}
