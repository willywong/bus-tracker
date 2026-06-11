import { Stack } from 'expo-router';

const sheetBackground = '#231F20';

export default function SettingsSheetStackDemoLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: {
          backgroundColor: sheetBackground,
        },
        contentStyle: {
          backgroundColor: sheetBackground,
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="account" options={{ title: 'Account' }} />
    </Stack>
  );
}
