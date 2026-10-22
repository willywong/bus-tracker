import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { NetworkSheetBody, useScreenReaderEnabled } from '@/components/rail/diagram/NetworkSheetBody';

/**
 * The schematic rail map (plan 13/06), full height over the map. Stations
 * open the station sheet on top; "Fit" eases out to the whole network.
 * VoiceOver gets a list instead, which has nothing to fit.
 */
export default function NetworkScreen() {
  const router = useRouter();
  const screenReader = useScreenReaderEnabled();
  const [fitSignal, setFitSignal] = useState(0);
  const openStation = useCallback(
    (id: string) => router.push({ pathname: '/station', params: { station: id } }),
    [router],
  );
  return (
    <>
      {screenReader === false ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="arrow.down.right.and.arrow.up.left"
            accessibilityLabel="Show the whole network"
            onPress={() => setFitSignal((n) => n + 1)}
          >
            <Stack.Toolbar.Label>Fit</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <NetworkSheetBody onOpenStation={openStation} fitSignal={fitSignal} />
    </>
  );
}
