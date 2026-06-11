import { Stack } from 'expo-router';
import { PlatformColor } from 'react-native';

export default function LiquidGlassDemoLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: {
          backgroundColor: PlatformColor('systemGroupedBackground'),
        },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Liquid Glass Demo' }} />
      <Stack.Screen
        name="glass-effect"
        options={{ title: 'expo-glass-effect' }}
      />
      <Stack.Screen
        name="swiftui-buttons"
        options={{ title: 'SwiftUI Buttons' }}
      />
      <Stack.Screen name="swiftui-menu" options={{ title: 'SwiftUI Menu' }} />
      <Stack.Screen
        name="swiftui-glass-effect"
        options={{ title: 'SwiftUI glassEffect' }}
      />
      <Stack.Screen
        name="reusable-components"
        options={{ title: 'Reusable Components' }}
      />
      <Stack.Screen
        name="settings-sheet-stack-demo"
        options={{ title: 'Settings Sheet Stack' }}
      />
      <Stack.Screen
        name="settings-sheet-stack-demo-sheet"
        options={{
          headerShown: false,
          presentation: 'formSheet',
          sheetAllowedDetents: [1.0],
          sheetInitialDetentIndex: 0,
          sheetLargestUndimmedDetentIndex: 0,
          sheetGrabberVisible: true,
          sheetCornerRadius: 36,
          contentStyle: {
            backgroundColor: '#231F20',
          },
        }}
      />
      <Stack.Screen name="native-tabs" options={{ title: 'NativeTabs' }} />
      <Stack.Screen
        name="stack-toolbar"
        options={{ title: 'Stack Toolbar', headerTransparent: true }}
      />
    </Stack>
  );
}
