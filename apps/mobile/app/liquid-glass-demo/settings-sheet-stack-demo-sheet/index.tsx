import { Button, HStack, Host, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import type { ImageProps } from '@expo/ui/swift-ui';
import { buttonStyle, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { Link, Stack, router } from 'expo-router';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import {
  DemoCard,
  DemoSection,
  InfoText,
} from '@/components/liquid-glass-demo/DemoScaffold';

const sheetBackground = '#231F20';

export default function SettingsSheetStackRoot() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerTransparent: true,
          // iOS 26-only native scroll edge effect, matching Account.
          scrollEdgeEffects: {
            top: 'soft',
            bottom: 'hidden',
            left: 'hidden',
            right: 'hidden',
          },
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: 'transparent',
          },
          contentStyle: {
            backgroundColor: sheetBackground,
          },
        }}
      />
      {Platform.OS === 'ios' ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            accessibilityLabel="Close settings sheet"
            icon="xmark"
            onPress={() => router.dismiss()}
          />
        </Stack.Toolbar>
      ) : null}

      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <DemoSection
          title="Settings"
          note="Sheet root: the X button dismisses the whole native sheet."
        >
          <DemoCard title="Native sheet stack">
            <InfoText>
              Tap Account to push a subpage inside this sheet. The subpage uses
              the native stack back button instead of a custom close button.
            </InfoText>
          </DemoCard>
        </DemoSection>

        <DemoSection title="Pages">
          <Host style={{ height: 206 }} useViewportSizeMeasurement>
            <VStack spacing={0} modifiers={[padding({ all: 12 })]}>
              <SettingsSheetRow
                href="/liquid-glass-demo/settings-sheet-stack-demo-sheet/account"
                icon="person.crop.circle"
                title="Account"
                subtitle="Profile, sign-in, and identity settings."
              />
              <SettingsSheetStaticRow
                icon="bell.badge"
                title="Notifications"
                subtitle="Leave-time alerts and quiet hours."
              />
              <SettingsSheetStaticRow
                icon="paintpalette"
                title="Appearance"
                subtitle="Theme and map display preferences."
              />
            </VStack>
          </Host>
        </DemoSection>
      </ScrollView>
    </>
  );
}

function SettingsSheetRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: ImageProps['systemName'];
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} asChild>
      <Button modifiers={[buttonStyle('plain')]}>
        <SettingsRowContent icon={icon} title={title} subtitle={subtitle} />
      </Button>
    </Link>
  );
}

function SettingsSheetStaticRow({
  icon,
  title,
  subtitle,
}: {
  icon: ImageProps['systemName'];
  title: string;
  subtitle: string;
}) {
  return (
    <Button modifiers={[buttonStyle('plain')]}>
      <SettingsRowContent icon={icon} title={title} subtitle={subtitle} />
    </Button>
  );
}

function SettingsRowContent({
  icon,
  title,
  subtitle,
}: {
  icon: ImageProps['systemName'];
  title: string;
  subtitle: string;
}) {
  return (
    <HStack spacing={12} modifiers={[padding({ vertical: 9 })]}>
      <Image systemName={icon} size={22} color="#8E8E93" />
      <VStack spacing={2} alignment="leading">
        <Text>{title}</Text>
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
          {subtitle}
        </Text>
      </VStack>
      <Spacer />
      <Image systemName="chevron.right" size={12} color="#8E8E93" />
    </HStack>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: sheetBackground,
  },
  content: {
    gap: 18,
    padding: 16,
    paddingBottom: 40,
  },
});
