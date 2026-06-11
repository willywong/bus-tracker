import { Stack } from 'expo-router';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import {
  DemoCard,
  DemoScroll,
  DemoSection,
  InfoText,
  PlatformFallback,
  demoColors,
} from '@/components/liquid-glass-demo/DemoScaffold';

export default function StackToolbarLiquidGlassDemo() {
  const isIOS = Platform.OS === 'ios';

  return (
    <>
      <DemoScroll>
        <DemoSection
          title="Stack.Toolbar"
          note="iOS-only: Stack.Toolbar uses native toolbar items. On iOS 26, the system renders Liquid Glass toolbar backgrounds."
        >
          {isIOS ? (
            <>
              <DemoCard title="Header toolbar">
                <InfoText>
                  Header left/right buttons are rendered by Stack.Toolbar with
                  SF Symbol icons, labels, and a badge.
                </InfoText>
              </DemoCard>
              <DemoCard title="Bottom toolbar">
                <InfoText>
                  The bottom toolbar contains buttons, Spacer, SearchBarSlot,
                  and an embedded React Native view with explicit dimensions.
                </InfoText>
              </DemoCard>
            </>
          ) : (
            <PlatformFallback feature="Expo Router Stack.Toolbar" />
          )}
        </DemoSection>
      </DemoScroll>

      {isIOS ? (
        <>
          <Stack.Screen.Title>Toolbar</Stack.Screen.Title>
          <Stack.SearchBar
            placeholder="Search demo"
            allowToolbarIntegration
            onChangeText={() => {}}
          />

          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              accessibilityLabel="Open sidebar"
              icon="sidebar.left"
              onPress={() => Alert.alert('Toolbar', 'Left icon button')}
            />
          </Stack.Toolbar>

          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              onPress={() => Alert.alert('Toolbar', 'Label button')}
            >
              <Stack.Toolbar.Label>Done</Stack.Toolbar.Label>
            </Stack.Toolbar.Button>
            <Stack.Toolbar.Button
              onPress={() => Alert.alert('Toolbar', 'Badge button')}
              variant="prominent"
            >
              <Stack.Toolbar.Icon sf="bell.fill" />
              <Stack.Toolbar.Label>Alerts</Stack.Toolbar.Label>
              <Stack.Toolbar.Badge>3</Stack.Toolbar.Badge>
            </Stack.Toolbar.Button>
          </Stack.Toolbar>

          <Stack.Toolbar placement="bottom">
            <Stack.Toolbar.Button
              icon="bus.fill"
              onPress={() => Alert.alert('Toolbar', 'Bus')}
              separateBackground
            />
            <Stack.Toolbar.Spacer />
            <Stack.Toolbar.SearchBarSlot />
            <Stack.Toolbar.Spacer />
            <Stack.Toolbar.View>
              <View style={styles.toolbarView}>
                <Text style={styles.toolbarCaption}>Glass</Text>
                <Text style={styles.toolbarValue}>iOS 26</Text>
              </View>
            </Stack.Toolbar.View>
            <Stack.Toolbar.Button
              icon="square.and.pencil"
              onPress={() => Alert.alert('Toolbar', 'Compose')}
              separateBackground
            />
          </Stack.Toolbar>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toolbarView: {
    width: 76,
    height: 34,
    justifyContent: 'center',
  },
  toolbarCaption: {
    color: demoColors.secondaryLabel,
    fontSize: 11,
    fontWeight: '600',
  },
  toolbarValue: {
    color: demoColors.blue,
    fontSize: 12,
    fontWeight: '800',
  },
});
