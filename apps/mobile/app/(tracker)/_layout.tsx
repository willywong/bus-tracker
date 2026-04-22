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
      <Stack.Screen
        name="add-bus"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.45, 1.0],
          sheetInitialDetentIndex: 1,
          sheetLargestUndimmedDetentIndex: 1,
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          contentStyle: { backgroundColor: '#1C1C1E' },
        }}
      />
    </Stack>
  );
}
