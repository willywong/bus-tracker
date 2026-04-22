import { Stack } from 'expo-router';
import { PlatformColor } from 'react-native';

export default function TrackerStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: PlatformColor('systemGroupedBackground'),
        },
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
