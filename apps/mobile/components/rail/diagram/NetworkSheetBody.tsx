import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { NetworkDiagram } from './NetworkDiagram';
import { NetworkList } from './NetworkList';

/**
 * Tracks VoiceOver: null until the first answer, so the screen doesn't mount
 * the diagram only to swap it for the list.
 */
export function useScreenReaderEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => mounted && setEnabled(v))
      .catch(() => mounted && setEnabled(false));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

/**
 * The rail map sheet's body (plan 13/06): the schematic, or with VoiceOver on
 * the same network as a list, switching live when VoiceOver toggles. The
 * screen supplies the toolbar and navigation: `onOpenStation` with a station
 * id, `onOpenLine` with a diagram line code (null when there's no network
 * to open it from), and `fitSignal`, a counter its Fit button bumps (the
 * diagram eases to the picked lines or the whole network on each new value).
 */
export function NetworkSheetBody({
  onOpenStation,
  onOpenLine,
  fitSignal,
}: {
  onOpenStation: (id: string) => void;
  onOpenLine: ((code: string) => void) | null;
  fitSignal: number;
}) {
  const screenReader = useScreenReaderEnabled();
  if (screenReader === null) return null;
  if (screenReader) return <NetworkList onOpenStation={onOpenStation} />;
  return (
    <NetworkDiagram onOpenStation={onOpenStation} onOpenLine={onOpenLine} fitSignal={fitSignal} />
  );
}
