import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { tokens, typeStyle } from '@/theme/tokens';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>This screen doesn't exist.</Text>
      <Link href="/" style={styles.link}>
        <Text style={styles.linkText}>Go to Tracker</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: tokens.color.bg,
  },
  title: { ...typeStyle.body, color: tokens.color.fg, fontWeight: '600' },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { ...typeStyle.body, color: tokens.color.accent },
});
