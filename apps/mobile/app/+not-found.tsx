import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { color, type } from '@/theme/design';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>This screen doesn’t exist.</Text>
      <Link href="/" style={styles.link}>
        <Text style={styles.linkText}>Back to the map</Text>
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
    backgroundColor: color.background,
  },
  title: { ...type.headline, color: color.label },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { ...type.body, color: color.accent },
});
