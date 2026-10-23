import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { routeIdOfLine } from '@/components/rail/diagram/lineFilter';
import {
  NetworkSheetBody,
  useScreenReaderEnabled,
} from '@/components/rail/diagram/NetworkSheetBody';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';

/**
 * The schematic rail map (plan 13/06), full height over the map. Stations
 * open the station sheet on top; with one line picked in the chip bar, "All
 * stops" opens it as a strip map (`/line`); "Fit" eases out to the picked
 * lines or the whole network. VoiceOver gets a list instead, which has
 * nothing to fit.
 */
export default function NetworkScreen() {
  const router = useRouter();
  const screenReader = useScreenReaderEnabled();
  const [fitSignal, setFitSignal] = useState(0);
  const openStation = useCallback(
    (id: string) => router.push({ pathname: '/station', params: { station: id } }),
    [router],
  );
  const { network } = useTransitNetwork();
  const openLine = useMemo(() => {
    if (!network) return null;
    return (code: string) => {
      const line = routeIdOfLine(network.routes, code);
      if (line) router.push({ pathname: '/line', params: { line, dir: '0' } });
    };
  }, [network, router]);
  return (
    <>
      {screenReader === false ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="arrow.down.right.and.arrow.up.left"
            accessibilityLabel="Fit the lines shown"
            onPress={() => setFitSignal((n) => n + 1)}
          >
            <Stack.Toolbar.Label>Fit</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="xmark"
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <NetworkSheetBody onOpenStation={openStation} onOpenLine={openLine} fitSignal={fitSignal} />
    </>
  );
}
