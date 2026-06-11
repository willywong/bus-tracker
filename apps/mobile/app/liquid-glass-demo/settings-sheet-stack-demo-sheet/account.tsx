import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  LabeledContent,
  Picker,
  Section,
  Text,
  Toggle,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  background,
  foregroundStyle,
  padding,
  scrollContentBackground,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

const sheetBackground = '#231F20';

export default function SettingsSheetAccountPage() {
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [serviceAlertsEnabled, setServiceAlertsEnabled] = useState(true);
  const [shareEtaEnabled, setShareEtaEnabled] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [defaultStop, setDefaultStop] = useState('kl-sentral');
  const [commuteProfile, setCommuteProfile] = useState('weekday');
  const [clockFormat, setClockFormat] = useState('relative');

  return (
    <View style={{ flex: 1, backgroundColor: sheetBackground }}>
      <Stack.Screen
        options={{
          title: 'Account',
          headerTransparent: true,
          // iOS 26-only native scroll edge effect. Kept here to check whether
          // SwiftUI Form inside @expo/ui Host can be discovered as the content
          // scroll view by react-native-screens.
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
      <Host
        style={{ flex: 1, backgroundColor: sheetBackground }}
        useViewportSizeMeasurement
      >
        <Form
          modifiers={[
            scrollContentBackground('hidden'),
            background(sheetBackground),
          ]}
        >
          <Section
            header={<Text>Profile</Text>}
            footer={
              <Text>
                This SwiftUI Form version removes the React Native ScrollView.
                If the top scroll-edge blur stops tracking, it means native
                stack cannot discover the Form's internal scroll view from JS.
              </Text>
            }
          >
            <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
              <Image systemName="person.crop.circle.fill" size={32} color="#0A84FF" />
              <Text>Demo Rider</Text>
            </HStack>
            <LabeledContent label="Plan">
              <Text>BusBuddy Plus</Text>
            </LabeledContent>
            <LabeledContent label="Account ID">
              <Text>BB-2048</Text>
            </LabeledContent>
          </Section>

          <Section header={<Text>Commute</Text>}>
            <Picker
              label="Default stop"
              systemImage="mappin.circle"
              selection={defaultStop}
              onSelectionChange={(value) => setDefaultStop(String(value))}
            >
              <Text modifiers={[tag('kl-sentral')]}>KL Sentral</Text>
              <Text modifiers={[tag('pasar-seni')]}>Pasar Seni</Text>
              <Text modifiers={[tag('ampang-park')]}>Ampang Park</Text>
            </Picker>
            <Picker
              label="Commute profile"
              systemImage="briefcase"
              selection={commuteProfile}
              onSelectionChange={(value) => setCommuteProfile(String(value))}
            >
              <Text modifiers={[tag('weekday')]}>Weekday</Text>
              <Text modifiers={[tag('weekend')]}>Weekend</Text>
              <Text modifiers={[tag('school-run')]}>School run</Text>
            </Picker>
            <Picker
              label="Time display"
              systemImage="clock"
              selection={clockFormat}
              onSelectionChange={(value) => setClockFormat(String(value))}
            >
              <Text modifiers={[tag('relative')]}>Arriving in 6 min</Text>
              <Text modifiers={[tag('absolute')]}>14:32</Text>
            </Picker>
          </Section>

          <Section header={<Text>Sync and alerts</Text>}>
            <Toggle
              label="Sync favorites"
              systemImage="icloud"
              isOn={syncEnabled}
              onIsOnChange={setSyncEnabled}
            />
            <Toggle
              label="Service alerts"
              systemImage="bell.badge"
              isOn={serviceAlertsEnabled}
              onIsOnChange={setServiceAlertsEnabled}
            />
            <Toggle
              label="Share ETA with contacts"
              systemImage="location.circle"
              isOn={shareEtaEnabled}
              onIsOnChange={setShareEtaEnabled}
            />
          </Section>

          <Section
            header={<Text>Saved data</Text>}
            footer={
              <Text>
                These rows are static demo values for the Liquid Glass
                playground.
              </Text>
            }
          >
            <LabeledContent label="Favorite routes">
              <Text>8</Text>
            </LabeledContent>
            <LabeledContent label="Saved stops">
              <Text>14</Text>
            </LabeledContent>
            <LabeledContent label="Offline timetable">
              <Text>Updated today</Text>
            </LabeledContent>
            <LabeledContent label="Last sync">
              <Text>2 min ago</Text>
            </LabeledContent>
          </Section>

          <Section header={<Text>Privacy</Text>}>
            <Toggle
              label="Improve arrival predictions"
              systemImage="chart.line.uptrend.xyaxis"
              isOn={analyticsEnabled}
              onIsOnChange={setAnalyticsEnabled}
            />
            <LabeledContent label="Location history">
              <Text>Never stored</Text>
            </LabeledContent>
            <LabeledContent label="Shared diagnostics">
              <Text>{analyticsEnabled ? 'On' : 'Off'}</Text>
            </LabeledContent>
          </Section>

          <Section header={<Text>Actions</Text>}>
            <Button
              label="Manage subscription"
              systemImage="creditcard"
              onPress={() => Alert.alert('Account', 'Manage subscription')}
              modifiers={[buttonStyle('plain')]}
            />
            <Button
              label="Export preferences"
              systemImage="square.and.arrow.up"
              onPress={() => Alert.alert('Account', 'Export preferences')}
              modifiers={[buttonStyle('plain')]}
            />
            <Button
              label="Clear cached timetable"
              systemImage="trash"
              onPress={() => Alert.alert('Account', 'Cached timetable cleared')}
              modifiers={[buttonStyle('plain')]}
            />
            <Button
              onPress={() => Alert.alert('Account', 'Signed out')}
              modifiers={[buttonStyle('plain')]}
            >
              <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
                <Image systemName="rectangle.portrait.and.arrow.right" size={18} color="#FF453A" />
                <Text modifiers={[foregroundStyle('#FF453A')]}>Sign out</Text>
              </HStack>
            </Button>
          </Section>

          <Section header={<Text>Native header behavior</Text>}>
            <HStack spacing={12} modifiers={[padding({ vertical: 6 })]}>
              <Image systemName="sparkles" size={22} color="#64D2FF" />
              <Text>
                This version keeps scrollEdgeEffects but removes the React
                Native ScrollView wrapper.
              </Text>
            </HStack>
          </Section>
        </Form>
      </Host>
    </View>
  );
}
