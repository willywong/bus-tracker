import { Button, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import { accessibilityHint, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { useColorScheme } from 'react-native';

import { openDataGovMy } from '@/components/trip/DataSources';
import { useTransitNetwork } from '@/hooks/useTransitNetwork';
import { hex, pick } from '@/theme/design';

import { DATA_CREDIT, dataSourceRows, type DataSourceRow } from './dataSources';

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const tertiary = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });

/**
 * Settings → Data sources (spec §3.6, §5): each network feed with its state
 * and end date, the CC BY 4.0 credit, and a way to the portal. An expiring
 * feed's date is orange; an expired or missing one is quiet. The words carry
 * the state, so colour is never the only signal.
 */
export function DataSourcesSection() {
  const { health } = useTransitNetwork();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tone = (t: DataSourceRow['tone']) =>
    t === 'warning' ? foregroundStyle(pick(hex.warning, scheme)) : t === 'muted' ? tertiary : secondary;

  return (
    <Section title="Data sources" footer={<Text>{DATA_CREDIT}</Text>}>
      {/* Before health is read the rows would all say "Not downloaded yet"; show nothing instead. */}
      {health
        ? dataSourceRows(health).map((row) => (
            <LabeledContent key={row.feed} label={row.title}>
              <Text modifiers={[tone(row.tone)]}>{row.detail}</Text>
            </LabeledContent>
          ))
        : null}
      <Button
        label="Open data.gov.my"
        onPress={openDataGovMy}
        modifiers={[accessibilityHint('Opens data.gov.my in the app')]}
      />
    </Section>
  );
}
