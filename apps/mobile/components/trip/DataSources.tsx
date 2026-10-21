import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, Text } from 'react-native';

import { color, type } from '@/theme/design';

const DATA_GOV_MY = 'https://data.gov.my';

/** Opens the open-data portal in an in-app Safari sheet. */
function openDataGovMy() {
  void WebBrowser.openBrowserAsync(DATA_GOV_MY, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });
}

/**
 * The sheet's footer, said once and quietly: where the times come from, in
 * a single small line of fine print. "data.gov.my" opens the portal in the
 * app rather than Safari.
 */
export function DataSources() {
  return (
    <Text style={styles.text}>
      Live times from bus GPS, schedules from Prasarana, weather from MET Malaysia. Open data via{' '}
      <Text
        style={styles.link}
        onPress={openDataGovMy}
        accessibilityRole="link"
        accessibilityHint="Opens data.gov.my in the app"
        suppressHighlighting={false}
      >
        data.gov.my
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...type.footnote,
    fontSize: 12,
    lineHeight: 16,
    color: color.tertiaryLabel,
  },
  link: {
    color: color.secondaryLabel,
  },
});
