import { StyleSheet, Text, View } from 'react-native';

import { tokens, typeStyle } from '@/theme/tokens';

export default function TrackerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>T816 Tracker</Text>
      <Text style={styles.body}>Countdown lands here in Phase 05.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 96,
    gap: 8,
    backgroundColor: tokens.color.bg,
  },
  title: { ...typeStyle.title, color: tokens.color.fg },
  body: { ...typeStyle.body, color: tokens.color.muted },
});
