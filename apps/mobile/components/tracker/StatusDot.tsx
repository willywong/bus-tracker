import { StyleSheet, View } from 'react-native';

interface StatusDotProps {
  color: string;
  size?: number;
}

export function StatusDot({ color, size = 8 }: StatusDotProps) {
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
