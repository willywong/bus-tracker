# Native iOS UI capability reference — bus-tracker (Expo SDK 58 / RN 0.88 / iOS 26 Liquid Glass)

Scope: what the **installed** packages in `/home/user/bus-tracker/node_modules` actually expose, verified against their `.d.ts` / native sources. Skill docs (expo/skills) were read and cross-checked; where they disagree with the installed code, the installed code wins and the conflict is called out.

Legend: **[V]** = verified in installed `.d.ts` or native source. **[S]** = from skill docs only, consistent with installed types. **[U]** = not verified (behavioral claim, device-only, or not found in types).

Installed versions: expo 58.0.16 · @expo/ui 58.0.21 · expo-router 58.0.24 · expo-glass-effect 58.0.4 · expo-blur 58.0.5 · expo-symbols 58.0.4 · expo-widgets 58.0.21 · react-native-reanimated 4.7.1 · react-native-worklets 0.13.0 · react-native-maps 1.29.11 · react-native-screens 4.30.0 · react-native-gesture-handler 3.0.0 (hoisted transitively, **not** a declared dep of `apps/mobile`, no `GestureHandlerRootView` in the app).

---

## 0. Corrections to the skill docs and to the app's current code

| Topic | Skill / current code says | Installed reality |
|---|---|---|
| NativeTabs import | `expo-router/unstable-native-tabs` (skill + `app/_layout.tsx:9`) | `expo-router/native-tabs` is the stable path. `unstable-native-tabs` still works but every export is marked `@deprecated Use expo-router/native-tabs` **[V]** `build/unstable-native-tabs.d.ts` |
| Zoom transition | task brief said `Link.Zoom` | Only `Link.AppleZoom`, `Link.AppleZoomTarget`, `<Link.Trigger withAppleZoom>` and `usePreventZoomTransitionDismissal` exist (iOS 18+) **[V]** |
| SwiftUI `BottomSheet` props | expo-ui SKILL shows `onDismiss` + `snapPoints` | That's the **universal** `BottomSheet` (`@expo/ui`). The **swift-ui** `BottomSheet` requires `isPresented` + `onIsPresentedChange(bool)`; `onDismiss` is optional (fires after dismiss); detents come from the `presentationDetents()` modifier on a `Group` child, plus `fitToContents` prop **[V]** |
| `List` not virtualized | expo-ui skill | True for the **universal** `List`/`ListItem`. The swift-ui `List.ForEach` (with `data`+`keyExtractor`+render fn) and `LazyVStack.ForEach`/`LazyHStack.ForEach` **recycle rows** (default `recycling: true`, `overscanCount: 10`, `estimatedItemSize: 64`) **[V]** |
| `Host` import | skill: "must import Host from `@expo/ui` root" | On iOS, `@expo/ui` root `Host` is literally `export { Host } from '@expo/ui/swift-ui'` (`build/universal/Host/index.ios.js`). Both are the same component on iOS **[V]**. Importing from root only matters for cross-platform files. |
| `buttonBorderShape` | `app/liquid-glass-demo/swiftui-buttons.tsx:95` says "not exported (56.0.15)" | Exported in 58: `buttonBorderShape('automatic'|'capsule'|'roundedRectangle'|'circle', cornerRadius?)` **[V]** — demo comment is stale |
| expo-symbols effects | task brief lists `replace`, `variableColor` effect types | `AnimationType = 'bounce' | 'pulse' | 'scale'` only; variable color is via `animationSpec.variableAnimationSpec`; **no `replace`** **[V]**. Rich effects (wiggle, breathe, rotate, drawOn/drawOff, appear/disappear) live in `@expo/ui`'s `symbolEffect()` modifier instead. |
| `tracksViewChanges` | common RN-maps perf advice | Doc-tag: `@platform iOS: Google Maps only`; no Apple Maps (`ios/AirMaps`) implementation exists **[V]**. It is a no-op with `PROVIDER_DEFAULT` on iOS. |
| `pitchEnabled` (maps) | `.d.ts` comment says "iOS: Google Maps only" | Apple Fabric view does `REMAP_MAPVIEW_PROP(pitchEnabled)` in `RNMapsMapView.mm` — works on Apple Maps **[V]** (doc comment stale) |
| Reanimated shared-element transitions | — | `SharedTransition` + `SharedTransitionBoundary` exported, but static flag `ENABLE_SHARED_ELEMENT_TRANSITIONS: false` by default **[V]**. Treat as off; use `Link.AppleZoom` instead. |
| Glass on iOS < 26 | — | `@expo/ui` `glassEffect()` renders **content unchanged (no background at all)** on iOS < 26; `buttonStyle('glass'|'glassProminent')` falls back to `.automatic` **[V]** `ios/Modifiers/GlassEffectModifier.swift`, `ViewModifierRegistry.swift:1756-1775`. The app's `glassIfAvailable()` helper returns `[]` — so icon FABs have **no backdrop** on iOS 18. Needs an explicit fallback modifier (see §2.9). |

---

## 1. Platform matrix & the one guard you need

| Capability | iOS 26+ | iOS 17–18 | Android | Web |
|---|---|---|---|---|
| `expo-glass-effect` GlassView/GlassContainer | real `UIGlassEffect` | renders plain `View` children (native view exists but no effect) | plain `View` (`GlassView.js` = `<View {...props}/>`) | plain `View` |
| `@expo/ui/swift-ui` (`glassEffect`, `GlassEffectContainer`, glass button styles) | yes | components yes, glass = no-op | **crash** ("Unable to get view config") | not supported |
| `@expo/ui` universal (`Host, Column, Row, Button, BottomSheet, Switch…`) | SwiftUI | SwiftUI | Compose | DOM |
| NativeTabs liquid glass bar, `minimizeBehavior`, `BottomAccessory` | yes | classic UITabBar; `minimizeBehavior`/`BottomAccessory` ignored | Material 3 bottom nav | custom/headless needed |
| `Stack.Toolbar` | glass bar items, `SearchBarSlot` (26+), `hidesSharedBackground` (26+) | classic UIBarButtonItems | supported (toolbar + IME padding, `tintColor`, `backgroundColor`) | — |
| `formSheet` w/ transparent `contentStyle` | glass sheet | standard sheet | modal sheet, max 3 detents, no grabber | — |
| `Link.Preview` / `Link.Menu` | yes | yes | no-op | no-op |
| `Link.AppleZoom` | yes (iOS 18+) | iOS 18 yes, 17 no | no | no |
| `scrollEdgeEffects` (stack option), `scrollEdgeEffectStyle` (swift-ui) | yes | ignored | — | — |

**Guard (already in app, keep it):** `components/GlassGuard.tsx` → `isGlassAvailable()` = `isGlassEffectAPIAvailable() && isLiquidGlassAvailable()` cached. Add `AccessibilityInfo.isReduceTransparencyEnabled()` → solid surface **[S]**.

`isLiquidGlassAvailable()` returns `false` if `Info.plist` has `UIDesignRequiresCompatibility = true` (unless built with iOS 27 SDK, where it is ignored and always `true`) **[V]** `GlassEffectModule.swift`. `app.json` does not set it → glass on.

Swift-ui code must not execute on Android/web. The app currently imports `@expo/ui/swift-ui` directly in shared components (`components/map/*Button.tsx`, `RouteSwitcher.tsx`, sheets, `app/settings.tsx`) with no `.ios.tsx` split → the map/settings/tracker screens are effectively iOS-only. If Android matters: move SwiftUI trees into `components/**/X.ios.tsx` with an `X.tsx` fallback (never platform-suffixed files inside `app/`) **[S]**.

---

## 2. `@expo/ui` 58.0.21

### 2.1 Import paths **[V]** (`package.json#exports`)

```ts
import { Host, Column, Row, Text, Button, BottomSheet, Switch, Slider, Picker, List, ListItem,
         FieldGroup, Collapsible, Checkbox, Icon, ScrollView, Spacer, TextInput, RNHostView,
         useNativeState } from '@expo/ui';                         // universal (iOS/Android/web)
import { /* SwiftUI views */ } from '@expo/ui/swift-ui';          // iOS only
import { /* modifiers */ } from '@expo/ui/swift-ui/modifiers';    // iOS only
// drop-ins: '@expo/ui/community/{bottom-sheet,datetime-picker,segmented-control,picker,slider,masked-view,menu,pager-view}'
```

Universal layer has **no glass API** (Button variants: `'filled'|'outlined'|'text'`) **[V]**. Liquid Glass requires the swift-ui layer or expo-glass-effect.

### 2.2 `Host` — sizing and interop **[V]** `build/swift-ui/Host/index.d.ts`

```ts
interface HostProps extends CommonViewModifierProps {
  matchContents?: boolean | { vertical?: boolean; horizontal?: boolean }; // set once on mount
  alignment?: Alignment;              // default 'topLeading' (58.0.20+) — content position when host ≠ content size
  useViewportSizeMeasurement?: boolean; // propose viewport size to SwiftUI (Form/List/ScrollView filling space)
  onLayoutContent?: (e: { nativeEvent: { width: number; height: number } }) => void;
  colorScheme?: 'light' | 'dark';
  seedColor?: ColorValue;             // propagates as SwiftUI tint
  layoutDirection?: 'leftToRight' | 'rightToLeft';
  ignoreSafeArea?: 'all' | 'container' | 'keyboard';
  style?: StyleProp<ViewStyle>; pointerEvents?: 'box-none'|'none'|'box-only'|'auto';
  children: React.ReactNode;
}
```

Sizing rules:
- **Compact chrome (buttons, chips, pills):** `<Host matchContents>` — RN takes the SwiftUI intrinsic size. Pair with `alignment="trailing"` when the host is pinned to a trailing edge and its content animates width (prevents jumping).
- **Fills its RN box:** `<Host style={{ flex: 1 }}>` (content is top-leading since 58.0.6, previously centered).
- **Form / List / ScrollView inside Host:** `useViewportSizeMeasurement` or an explicit RN height.
- **Width from RN, height from SwiftUI:** `matchContents={{ vertical: true }}` + RN width.

`RNHostView` — embed RN views inside a SwiftUI tree **[V]**:
```ts
interface RNHostViewProps { matchContents?: boolean | { vertical?: boolean; horizontal?: boolean }; onLayout?: (e: LayoutChangeEvent) => void; children: React.ReactElement; }
```
Dev warning since 58.0.x when a `Host` renders directly inside another `Host` without an `RNHostView` between them (changelog). Hosted RN `Pressable`s receive touches inside `BottomSheet`/`Popover` (fixed in 58) **[V changelog]**.

### 2.3 SwiftUI components (`@expo/ui/swift-ui`) **[V]** `build/swift-ui/index.d.ts`

All accept `modifiers?: ViewModifier[]` and `testID?`.

| Component | Key props (exact) |
|---|---|
| `HStack` | `spacing?`, `alignment?: 'top'|'center'|'bottom'|'firstTextBaseline'|'lastTextBaseline'` |
| `VStack` | `spacing?`, `alignment?: 'leading'|'center'|'trailing'` |
| `ZStack`, `Group`, `Spacer`, `Divider` | — (`Group` is the carrier for presentation modifiers inside sheets) |
| `Grid` + `Grid.Row` | `alignment?`, `verticalSpacing?`, `horizontalSpacing?` |
| `LazyVStack` / `LazyHStack` + `.ForEach` | stack: `spacing?`, `alignment?`; ForEach: `data`, `keyExtractor(item,i)`, `children({item,index})`, `recycling? = true`, `overscanCount? = 10`, `estimatedItemSize? = 64` |
| `ScrollView` | `axes?: 'vertical'|'horizontal'|'both'`, `showsIndicators?` |
| `List` + `List.ForEach` | `selection?`, `onSelectionChange?`; ForEach: `data`, `keyExtractor`, render fn, `onDelete?(indices)`, `onMove?(src, dest)`, recycling props |
| `Form`, `Section` | Section: `title?`, `header?`, `footer?`, `isExpanded?`, `onIsExpandedChange?` |
| `Text` | `children`, `markdownEnabled?`, `date?: Date`, `dateStyle?: 'timer'|'relative'|'offset'|'date'|'time'`, `timerInterval?: {lower: Date; upper: Date}` (iOS 16+), `countsDown? = true`, `pauseTime?: Date` |
| `Image` | `systemName?: SFSymbol`, `assetName?`, `uiImage?` (sync file read — blocks main thread), `size?`, `color?`, `variableValue?: 0..1` (iOS 16+), `onPress?` |
| `Label` | `title?`, `systemImage?`, `icon?: ReactNode`, `children?` (custom title view) |
| `Button` | `onPress?`, `label?`, `systemImage?` (only with `label`), `role?: 'default'|'cancel'|'destructive'|'close'` (`close` w/o label draws an xmark), `children?: ReactElement | ReactElement[]` (no bare strings), `target?` (widgets/live activities) |
| `Menu` | `label: string | ReactNode`, `systemImage?`, `onPrimaryAction?` (tap = action, long-press = menu), `children` (Button/Toggle/Picker/Section/Divider/Menu) |
| `ContextMenu` + `.Trigger` / `.Preview` / `.Items` | long-press menu with optional custom preview |
| `ControlGroup` | `label?`, `systemImage?`, `children` |
| `Picker` | `label?`, `systemImage?`, `selection?`, `onSelectionChange?`; options are `<Text modifiers={[tag(v)]}>`; style via `pickerStyle('automatic'|'inline'|'menu'|'navigationLink'|'palette'|'segmented'|'wheel')` |
| `Toggle` | `isOn?`, `label?`, `systemImage?`, `onIsOnChange?`, `children?`; `toggleStyle('automatic'|'switch'|'button')` |
| `SyncToggle` | worklet/native-state toggle (see types) |
| `Slider` | `value?`, `step?`, `min?`, `max?`, `lowerLimit?`, `upperLimit?`, `label?`, `minimumValueLabel?`, `maximumValueLabel?`, `onValueChange?`, `onEditingChanged?` |
| `Stepper`, `DatePicker`, `ColorPicker`, `TextField`, `SecureField` | standard |
| `Gauge` | `value`, `min? = 0`, `max? = 1`, `children?` (label), `currentValueLabel?`, `minimumValueLabel?`, `maximumValueLabel?`; `gaugeStyle('automatic'|'circular'|'circularCapacity'|'linear'|'linearCapacity')` |
| `ProgressView` | `value?: number|null` (null = indeterminate), `timerInterval?: {lower, upper}` (auto-progress, iOS 16+), `countsDown? = true`, `children?`; `progressViewStyle('automatic'|'linear'|'circular')` |
| `Chart` | `data: {x: string|number; y: number; color?}[]`, `type?: 'line'|'point'|'bar'|'area'|'pie'|'rectangle'`, `showGrid?`, `animate?`, `showLegend?`, `referenceLines?`, `lineStyle?{dashArray,width,pointStyle,pointSize,color}`, `barStyle?`, `areaStyle?`, `pieStyle?`, `ruleStyle?`, `style?` |
| `BottomSheet` | `isPresented`, `onIsPresentedChange(bool)` (**required**), `onDismiss?`, `fitToContents?`, `anchor?: ReactNode`, `children` (mounted only while presented; wrap in `Group` for presentation modifiers) |
| `Popover` + `.Trigger` / `.Content` | `isPresented?`, `onIsPresentedChange?`, `attachmentAnchor?`, `arrowEdge?` |
| `Alert`, `ConfirmationDialog` (+ `.Trigger/.Actions/.Message`) | `title`, `isPresented?`, `onIsPresentedChange?`, `titleVisibility?` |
| `DisclosureGroup` (+ `.Label`) | `label?`, `isExpanded?`, `onIsExpandedChange?` |
| `SwipeActions` + `SwipeActions.Actions` | Actions: `edge? = 'trailing'`, `allowsFullSwipe? = true` |
| `ContentUnavailableView` | `title?`, `systemImage?`, `description?` — native empty state |
| `LabeledContent`, `ShareLink`, `Link` | standard |
| `GlassEffectContainer` | `spacing?` (merge distance), `children` (views with `glassEffect`) |
| `Namespace` | `id: string` (use `React.useId()`), `children` — scope for `glassEffectId` / `matchedGeometryEffect` |
| `Background` / `Overlay` / `Mask` (+ `.Content`) | `alignment?` — arbitrary view behind/over/masking content |
| Shapes: `Rectangle`, `RoundedRectangle{cornerRadius}`, `UnevenRoundedRectangle{topLeadingRadius…}`, `Capsule{cornerStyle}`, `Circle`, `Ellipse`, `ConcentricRectangle{corners}` (+ `EdgeCornerStyle.concentric(min?)/fixed(r)`) | |
| `NavigationStack`, `NavigationLink`, `NavigationDestination`, `NavigationSplitView`, `TabView` + `TabView.Tab`, `Toolbar` + `ToolbarItem{placement, visibilityPriority}` | in-Host SwiftUI navigation (rarely needed with expo-router) |
| `AccessoryWidgetBackground` | widgets |
| Also exported | `useNativeState`, `useWorkletCallback`, `withAnimation` |

### 2.4 Modifiers (`@expo/ui/swift-ui/modifiers`) — exact signatures **[V]**

Layout / geometry
```ts
padding(p?: { top?, bottom?, leading?, trailing?, horizontal?, vertical?, all?: number | 'default' })
frame({ width?, height?, alignment? })                                   // fixed overload
frame({ minWidth?, idealWidth?, maxWidth?, minHeight?, idealHeight?, maxHeight?, alignment? }) // flexible overload — don't mix with fixed keys
containerRelativeFrame({ axes, count?, span?, spacing?, alignment? })    // iOS 17+
fixedSize({ horizontal?, vertical? }?) · layoutPriority(n) · aspectRatio({ ratio?, contentMode?: 'fit'|'fill' })
offset({ x?, y? }) · zIndex(n) · ignoreSafeArea({ regions?, edges? }?) · alignmentGuide(...)
geometryGroup()                                                           // iOS 17+
onGeometryChange(handler(frame)) · onAppear(fn) · onDisappear(fn)
```
Visual
```ts
background(style: ShapeStyle, options?: { ignoresSafeAreaEdges? })
background(style: ShapeStyle, shape?: Shape)            // shapes.roundedRectangle({cornerRadius, roundedCornerStyle:'continuous'}) | shapes.capsule() | circle() | rectangle() | ellipse() | containerRelativeShape()
foregroundStyle(style: ShapeStyle) · tint(style: ShapeStyle) · opacity(n)
clipShape('rectangle'|'circle'|'capsule'|'ellipse'|'roundedRectangle'|'containerRelativeShape', cornerRadius?)
mask(sameShapes, cornerRadius?) · clipped(bool?) · cornerRadius(n)
border({ ... }) · strokeBorder({ ... }) · overlay({ color?, alignment? })
shadow({ radius, x?, y?, color? })
blur(r) · brightness · contrast · saturation · hueRotation · grayscale · colorInvert · luminanceToAlpha
scaleEffect(n | {x,y}) · rotationEffect(deg) · rotation3DEffect({...})
containerShape(shape) · contentShape(shape, kind?) · containerBackground(style, placement)
// ShapeStyle = Color | {type:'color',color} | {type:'hierarchical',style:'primary'|'secondary'|'tertiary'|'quaternary'|'quinary'}
//            | {type:'material',material:'ultraThin'|'thin'|'regular'|'thick'|'ultraThick'|'bar'}
//            | {type:'linearGradient',colors,startPoint,endPoint} | {type:'radialGradient',...} | {type:'angularGradient',...}
// Color accepts hex, named, PlatformColor(...)
```
Liquid Glass (iOS 26; no-op below)
```ts
glassEffect(params?: {
  glass?: { variant: 'regular' | 'clear' | 'identity'; interactive?: boolean; tint?: Color };
  shape?: 'circle' | 'capsule' | 'rectangle' | 'ellipse' | 'roundedRectangle' | 'containerRelativeShape';
  cornerRadius?: number;
})
glassEffectId(id: string, namespaceId: string)       // morphing inside GlassEffectContainer + Namespace
buttonStyle('automatic'|'bordered'|'borderedProminent'|'borderless'|'glass'|'glassProminent'|'plain')
buttonBorderShape('automatic'|'capsule'|'roundedRectangle'|'circle', cornerRadius?)
controlSize('mini'|'small'|'regular'|'large'|'extraLarge')
scrollEdgeEffectStyle('automatic'|'hard'|'soft', edges?)   // iOS 26
```
Typography
```ts
font({ family?, size? = 17, weight?: 'ultraLight'…'black', design?: 'default'|'rounded'|'serif'|'monospaced', textStyle?: 'largeTitle'|'title'|'title2'|'title3'|'headline'|'subheadline'|'body'|'callout'|'footnote'|'caption'|'caption2' })
// textStyle => scales with Dynamic Type; size-only => fixed
bold() · italic() · monospacedDigit() · kerning(n?) · textCase('lowercase'|'uppercase') · underline({...}) · strikethrough({...})
lineLimit(n, {reservesSpace?}?) · lineSpacing(n) · lineHeight(n) · multilineTextAlignment(...) · truncationMode(...)
minimumScaleFactor(f) · allowsTightening(b) · textSelection(b) · dynamicTypeSize(size | {min,max})
contentTransition('numericText'|'identity'|'opacity'|'interpolate', { countsDown? }?)   // iOS 16+
imageScale('small'|'medium'|'large') · resizable(capInsets?, mode?)
```
Animation / state
```ts
import { animation, Animation } from '@expo/ui/swift-ui/modifiers';
animation(Animation.spring({ response?, dampingFraction?, blendDuration?, duration?, bounce? }), watchedValue: number | boolean)
// presets: easeInOut/easeIn/easeOut/linear({duration}) · interpolatingSpring({...}) · smooth/snappy/bouncy({duration?, extraBounce?}) · Animation.default
// chain: .delay(sec).repeat({ repeatCount, autoreverses? })   — durations are SECONDS
matchedGeometryEffect(id, namespaceId, { properties?: 'frame'|'position'|'size', anchor?, isSource? })
symbolEffect(effect, { options?: { repeat?: 'continuous'|'nonRepeating'|{count?,delay?}, speed? }, isActive?: ObservableState<boolean>, value?: ObservableState<number|string|boolean> })
//   effects: appear/disappear/bounce/pulse/scale/variableColor (iOS 17) · wiggle/breathe/rotate (iOS 18) · drawOn/drawOff (iOS 26)
//   NOTE: isActive/value must be useNativeState() objects, not plain booleans
redacted('placeholder'|'privacy'|'invalidated'|[...]) · unredacted() · invalidatableContent(b?)   // native skeletons
```
withAnimation (worklet transaction) **[V]** `withAnimation.d.ts`:
```ts
withAnimation(animation: ChainableAnimationType | null, body: () => void /* worklet mutating useNativeState values */, completion?: () => void /* iOS 17+ */, completionCriteria?: 'logicallyComplete' | 'removed')
```
Lists / scroll
```ts
listStyle('automatic'|'plain'|'inset'|'insetGrouped'|'grouped'|'sidebar') · listRowBackground(color) · listRowSeparator(vis, edges?)
listRowSeparatorTint(color?, edges?) · listRowInsets({...}) · listRowSpacing(n?) · listSectionSpacing('default'|'compact'|n) · listSectionMargins({...}?)
scrollContentBackground('automatic'|'visible'|'hidden') · scrollIndicators(vis, axes?) · scrollDisabled(b?) · scrollClipDisabled(b?)
scrollTargetBehavior('paging'|'viewAligned') · scrollTargetLayout() · defaultScrollAnchor(anchor) · scrollDismissesKeyboard(mode)
scrollPosition(state: ObservableState<string|null>, opts?) + id('row-key') · onScrollPhaseChange(cb(phase, geometry)) · useScrollGeometryChange(cb)
refreshable(async () => {}) · moveDisabled · deleteDisabled · badge(str?) · badgeProminence(...) · headerProminence(...)
```
Sheets / presentation (apply to a `Group` inside `BottomSheet`)
```ts
presentationDetents(detents: ('medium'|'large'|{fraction:number}|{height:number})[], { selection?, onSelectionChange?(detent) }?)  // iOS 16+
presentationDragIndicator('automatic'|'visible'|'hidden')
presentationCornerRadius(n | null)                           // iOS 16.4+
presentationBackgroundInteraction('automatic'|'enabled'|'disabled'|{ type:'enabledUpThrough', detent })  // iOS 16.4+
presentationBackground(style: ShapeStyle)                    // iOS 26 renders a material as flat color (doc note)
interactiveDismissDisabled(b? = true)
presentationSizing('automatic'|'fitted'|'form'|'page', { fitted?: {horizontal?, vertical?} }?)   // iOS 18+, mostly iPad
preferredColorScheme('light'|'dark'|null)                    // sets sheet color scheme incl. background
```
Interaction / a11y: `onTapGesture(fn)`, `onLongPressGesture(fn, minDuration?)`, `disabled(b?)`, `hidden(b?)`, `menuStyle`, `menuIndicator`, `menuOrder`, `menuActionDismissBehavior`, `labelStyle`, `labelsHidden()`, `accessibilityLabel/Hint/Value/Identifier/Hidden/Element/AddTraits/RemoveTraits/InputLabels`, `textFieldStyle`, `keyboardType`, `submitLabel`, `onSubmit`, `searchable(textState, opts)`, `searchToolbarBehavior`, `tag(v)`, `environment(...)`.
Widgets: `widgetURL(url)`, `widgetAccentedRenderingMode(...)`, `activityBackgroundTint(color|null)`.

Not present in 58 (don't design around them): `.transition()` view transitions, `glassEffectTransition`, `glassEffectUnion`, `backgroundExtensionEffect`, `safeAreaBar` **[V by absence]**.

### 2.5 useNativeState **[V]** `build/State/useNativeState.d.ts`
```ts
const s = useNativeState<T>(initial);   // ObservableState<T>: .value, .get(), .set(v), .onChange = (v) => { 'worklet'; ... }
```
Writes from a UI worklet are synchronous; JS-thread writes are async. Requires `react-native-worklets` (installed 0.13). Used for: `symbolEffect` triggers, `withAnimation`, `scrollPosition`, `searchable`, `TextField`/universal `TextInput` values.

### 2.6 Snippets

Glass icon FAB (current app pattern, plus a pre-26 fallback):
```tsx
import { Host, HStack, Image } from '@expo/ui/swift-ui';
import { frame, glassEffect, background, shapes } from '@expo/ui/swift-ui/modifiers';
import { isGlassAvailable } from '@/components/GlassGuard';

const surface = isGlassAvailable()
  ? glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })
  : background({ type: 'material', material: 'regular' }, shapes.circle()); // iOS < 26 fallback

<Host matchContents>
  <HStack modifiers={[frame({ width: 44, height: 44 }), surface]}>
    <Image systemName="scope" size={20} />
  </HStack>
</Host>
```
Prefer a native SwiftUI `Button` over RN `Pressable`-wrapped Host when possible — you get the glass press bulge + proper hit-testing:
```tsx
<Host matchContents>
  <Button systemImage="location.fill" label="Recenter" onPress={recenter}
    modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('large'), labelStyle('iconOnly')]} />
</Host>
```
(All modifier names/args verified; that `labelStyle('iconOnly')` collapses a `label`+`systemImage` Button to icon-only, and that RN-side tap handling is no longer needed, is standard SwiftUI behavior but **[U]** in this bridge — alternatively pass `children={<Image systemName="location.fill" />}` and an `accessibilityLabel('Recenter')` modifier.)
Morphing glass cluster (e.g. map controls that merge/split):
```tsx
const ns = useId();
<Host matchContents>
  <Namespace id={ns}>
    <GlassEffectContainer spacing={20}>
      <VStack spacing={8} modifiers={[animation(Animation.snappy(), expanded)]}>
        <Image systemName="map" size={20} modifiers={[frame({width:44,height:44}), glassEffect({glass:{variant:'regular',interactive:true}, shape:'circle'}), glassEffectId('map', ns)]} />
        {expanded && <Image systemName="car.fill" size={20} modifiers={[frame({width:44,height:44}), glassEffect({glass:{variant:'regular',interactive:true}, shape:'circle'}), glassEffectId('traffic', ns)]} />}
      </VStack>
    </GlassEffectContainer>
  </Namespace>
</Host>
```
Self-ticking countdown (no JS timer, no re-renders):
```tsx
<Host matchContents>
  <Text date={arrivalDate} dateStyle="timer"
        modifiers={[font({ size: 96, weight: 'bold', design: 'rounded' }), monospacedDigit(),
                    contentTransition('numericText', { countsDown: true })]} />
</Host>
// or a bounded timer: <Text timerInterval={{ lower: now, upper: arrival }} countsDown />
// paired bar: <ProgressView timerInterval={{ lower: tripStart, upper: arrival }} countsDown={false} />
```
Value-driven numeric morph (when you control the number):
```tsx
<Text modifiers={[font({ textStyle: 'largeTitle', weight: 'bold' }), monospacedDigit(),
                  contentTransition('numericText', { countsDown: true }), animation(Animation.snappy(), minutes)]}>
  {String(minutes)}
</Text>
```
Persistent Apple-Maps-style sheet over the map:
```tsx
<Host matchContents style={{ position: 'absolute', width }}>
  <BottomSheet isPresented onIsPresentedChange={() => {}}>
    <Group modifiers={[
      presentationDetents([{ height: 120 }, 'medium', 'large'], { selection: detent, onSelectionChange: setDetent }),
      presentationDragIndicator('visible'),
      presentationBackgroundInteraction({ type: 'enabledUpThrough', detent: 'medium' }),
      interactiveDismissDisabled(),
    ]}>
      {/* SwiftUI content; RN content via <RNHostView> */}
    </Group>
  </BottomSheet>
</Host>
```
Recycled stop list inside one Host:
```tsx
<Host style={{ flex: 1 }}>
  <List modifiers={[listStyle('insetGrouped')]}>
    <List.ForEach data={stops} keyExtractor={(s) => s.id}>
      {useCallback(({ item }) => <StopRow stop={item} />, [])}
    </List.ForEach>
  </List>
</Host>
```

### 2.7 Performance gotchas
- **One Host per row inside a FlatList** = one `UIHostingController` per cell, mounted/unmounted on recycle **[U — reasoning, not benchmarked]**. For long lists either (a) plain RN rows in FlatList, or (b) one `Host` containing `List.ForEach` / `LazyVStack.ForEach` (recycled natively) **[V that recycling exists]**. Don't put `entering` layout animations on virtualized rows **[S]**.
- `List.ForEach` / `LazyVStack.ForEach` render fns: wrap in `useCallback`; recycled rows keep local `useState` — key state by item **[V doc comment]**.
- `matchContents` can be set only once on mount **[V]**; changing it later is ignored.
- `Image uiImage` does a synchronous main-thread read **[V]**.
- `animation()` durations are **seconds** (SwiftUI); Reanimated uses ms.
- Content inside a `BottomSheet` is unmounted after dismiss **[V]**.

---

## 3. expo-glass-effect 58.0.4 **[V]** `build/*.d.ts`, `ios/GlassView.swift`

```ts
import { GlassView, GlassContainer, isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect';
type GlassStyle = 'clear' | 'regular' | 'none';
type GlassViewProps = ViewProps & {
  glassEffectStyle?: GlassStyle | { style: GlassStyle; animate?: boolean; animationDuration?: number /* s */ }; // default 'regular'
  tintColor?: ColorValue;      // PlatformColor/DynamicColorIOS OK since 58.0.0
  isInteractive?: boolean;     // default false; changing it tears down & recreates the effect
  colorScheme?: 'auto' | 'light' | 'dark';
};
type GlassContainerProps = ViewProps & { spacing?: number };  // merge distance for child GlassViews
```
Native behaviors that matter:
- Corner shape comes from RN `borderRadius` / per-corner radii / `borderCurve` mapped to `UIVisualEffectView.cornerConfiguration` — **don't** put `overflow:'hidden'` on the GlassView or its ancestors (clips rim highlight/press bulge) **[S]**.
- Effect is installed in `layoutSubviews` only when the accumulated ancestor alpha > 0.02 and the view is in a window; if not, it polls via `CADisplayLink` until visible (fixed in 58.0.2 for fade-ins) **[V]**. Still: animate the content, not the opacity of a glass ancestor **[S]**; for look changes use `glassEffectStyle={{ style, animate: true }}`.
- Children are mounted into `glassEffectView.contentView` **[V]**.
- Android/web: `GlassView`/`GlassContainer` are plain `View`s **[V]**.

Snippet (glass card over map with fallback): see `GlassGuard` in the app; prefer `glassEffectStyle="regular"` for content cards and `"clear"` only over rich imagery (needs a dimming layer for legibility) **[U design guidance]**.

---

## 4. expo-blur 58.0.5 **[V]**
`<BlurView tint intensity={0..100} blurReductionFactor? blurMethod?: 'none'|'dimezisBlurView'|'dimezisBlurViewSdk31Plus' blurTarget?: RefObject<View> />` plus `BlurTargetView` (Android: real blur needs a `BlurTargetView` wrapping the content and `blurTarget` ref). Tints include all `system*Material[Light|Dark]`. Use as the iOS < 26 fallback for glass; never animate `intensity` **[S]**.

---

## 5. expo-router 58.0.24

### 5.1 NativeTabs **[V]** `build/native-tabs/*.d.ts`
```tsx
import { NativeTabs } from 'expo-router/native-tabs';   // NOT unstable-native-tabs (deprecated)

<NativeTabs
  minimizeBehavior="onScrollDown"   // 'automatic'|'never'|'onScrollDown'|'onScrollUp' — iOS 26+
  tintColor={...} iconColor={{ default, selected }} labelStyle={{ default, selected }}
  hidden={bool}                     // whole bar, dynamic OK
  sidebarAdaptable                  // iPad only
  backBehavior="history"
  // backgroundColor / blurEffect / disableTransparentOnScrollEdge: NO EFFECT on iOS 26 (system draws the glass bar)
>
  <NativeTabs.BottomAccessory>{/* iOS 26+; rendered twice: regular + inline */}</NativeTabs.BottomAccessory>
  <NativeTabs.Trigger name="(tracker)" role?="search|favorites|recents|…" disablePopToTop? disableScrollToTop?
                      disableAutomaticContentInsets? contentStyle? hidden? disabled?>
    <NativeTabs.Trigger.Icon sf={{ default: 'tram', selected: 'tram.fill' }} md="directions_bus" selectedColor? />
    <NativeTabs.Trigger.Label hidden?>Tracker</NativeTabs.Trigger.Label>
    <NativeTabs.Trigger.Badge hidden? selectedBackgroundColor?>2</NativeTabs.Trigger.Badge>   {/* empty = dot */}
  </NativeTabs.Trigger>
</NativeTabs>
```
- `NativeTabs.BottomAccessory.usePlacement(): 'regular' | 'inline'` — two instances render simultaneously; keep state outside **[V/S]**.
- `role="search"` turns the tab into the iOS 26 detached search button; pair with `Stack.SearchBar` / `headerSearchBarOptions` in that tab's stack **[S]**.
- Roles: `bookmarks|contacts|downloads|favorites|featured|history|more|mostRecent|mostViewed|recents|search|topRated` **[V]**.
- Tabs must be static (no add/remove at runtime); `Trigger hidden` must not toggle after mount **[S]**.
- NativeTabs render no header → nest a `Stack` per tab for headers/toolbars **[S]**. **The app's `map` tab is a bare route (`app/map.tsx`) → no Stack → can't use `Stack.Toolbar`/`Stack.Header` there without moving it to `app/(map)/_layout.tsx` + `index.tsx`.**

### 5.2 Stack header, title, search, toolbar **[V]** `build/layouts/StackClient.d.ts`, `stack-utils/*`
```tsx
import { Stack, Color } from 'expo-router';
// Composition API inside a page:
<Stack.Screen options={{ headerTransparent: true, scrollEdgeEffects: { top: 'soft', bottom: 'hidden' } }} />
<Stack.Screen.Title large style={{ color }} largeStyle={{...}}>Tracker</Stack.Screen.Title>   // also Stack.Title
<Stack.Header transparent blurEffect="systemChromeMaterial" style={{ backgroundColor, shadowColor:'transparent' }} hidden? asChild? />
<Stack.SearchBar placeholder="Search stops" onChangeText={e => ...} hideWhenScrolling placement="automatic|inline|stacked" allowToolbarIntegration />
<Stack.Toolbar placement="right">          {/* 'left' | 'right' | 'bottom' (default) ; also asChild */}
  <Stack.Toolbar.Button icon="bell" onPress={...} variant="prominent" selected? separateBackground? hidesSharedBackground? tintColor? />
  <Stack.Toolbar.Button onPress={...}><Stack.Toolbar.Icon sf="bell.fill" /><Stack.Toolbar.Label>Alerts</Stack.Toolbar.Label><Stack.Toolbar.Badge>3</Stack.Toolbar.Badge></Stack.Toolbar.Button>
  <Stack.Toolbar.Menu icon="ellipsis" title? inline? palette? elementSize="auto|small|medium|large">
    <Stack.Toolbar.MenuAction icon="star" isOn subtitle? destructive? onPress={...}>Favourite</Stack.Toolbar.MenuAction>
  </Stack.Toolbar.Menu>
</Stack.Toolbar>
<Stack.Toolbar placement="bottom">          {/* page components only, not layouts */}
  <Stack.Toolbar.Spacer />                  {/* header placements need width={n} */}
  <Stack.Toolbar.SearchBarSlot />           {/* iOS 26+ */}
  <Stack.Toolbar.View><View style={{ width: 120, height: 32 }}>…</View></Stack.Toolbar.View>  {/* single child, explicit size */}
</Stack.Toolbar>
```
- `variant: 'plain' | 'done' | 'prominent'` (prominent = tinted glass on iOS 26) **[V]**.
- `Stack.Toolbar` left/right forces `headerShown: true` **[V doc]**. Last-rendered toolbar for a placement wins. Children must be `Stack.Toolbar.*` directly (no wrapper components returning fragments of items) **[S]**.
- `Stack.Toolbar` now also renders on **Android** (tint/background/IME padding props are Android-only) **[V]**.
- `headerLargeTitleEnabled` replaces deprecated `headerLargeTitle` **[V]**. `headerBlurEffect` + `scrollEdgeEffects` together can double up **[V doc]**.
- First child should be the ScrollView with `contentInsetAdjustmentBehavior="automatic"` so large-title collapse and edge effects attach **[S]**.
- Bottom toolbar inside a NativeTabs tab on iOS 26: interaction with the floating tab bar **[U]** — test on device.

### 5.3 formSheet **[V]** `react-navigation/native-stack/types.d.ts`
```tsx
<Stack.Screen name="stop/[id]" options={{
  presentation: 'formSheet',
  sheetAllowedDetents: [0.2, 0.5, 1] /* ascending; or 'fitToContents' (needs sized content) */,
  sheetInitialDetentIndex: 0 /* or 'last' */,
  sheetLargestUndimmedDetentIndex: 1 /* number | 'none' | 'last' — map stays interactive up to this detent */,
  sheetGrabberVisible: true,               // iOS only
  sheetCornerRadius: undefined,            // leave unset on iOS 26 to get system concentric radius [U design]
  sheetExpandsWhenScrolledToEdge: true,    // iOS
  contentStyle: { backgroundColor: 'transparent' },  // => Liquid Glass sheet on iOS 26 [S]
  headerTransparent: true,
  gestureEnabled: false,                   // => modalInPresentation = true (non-dismissable) [V RNSScreen.mm:359]
}} />
// listen: navigation.addListener('sheetDetentChange', e => e.data.index /* .stable */)
```
Android: max 3 detents, no grabber, can't host native header/nested stack; `sheetElevation`, `sheetShouldOverflowTopInset`, `sheetResizeAnimationEnabled`, `unstable_sheetFooter` are Android-only **[V]**.
**Current app:** `(tracker)/add-bus` uses `contentStyle: { backgroundColor: '#1C1C1E' }` and `sheetCornerRadius: 24` → opaque, non-glass sheet; the demo sheet uses `#231F20`. Switch to transparent to get glass.

### 5.4 Link preview / menu / zoom **[V]** `build/link/*.d.ts`
```tsx
import { Link, usePreventZoomTransitionDismissal } from 'expo-router';
<Link href={`/stop/${id}`} asChild>
  <Link.Trigger withAppleZoom>            {/* or wrap only the hero in <Link.AppleZoom alignmentRect?> */}
    <Pressable>…</Pressable>
  </Link.Trigger>
  <Link.Preview style={{ width: 320, height: 220 }} />   {/* optional custom children */}
  <Link.Menu title? icon? inline? palette? elementSize? destructive?>
    <Link.MenuAction title="Set as home stop" icon="house" isOn? subtitle? destructive? onPress={...} />
  </Link.Menu>
</Link>
// destination: <Link.AppleZoomTarget><Image …/></Link.AppleZoomTarget>; usePreventZoomTransitionDismissal({ unstable_dismissalBoundsRect })
```
Zoom: iOS 18+, Stack only (not sheets/popovers), avoid skinny full-width rows as sources **[S]**. `useIsPreview()` lets the destination render a lighter preview **[V export]**.

### 5.5 Colors **[V]**
`import { Color } from 'expo-router'` → `Color.ios.systemBlue`, `Color.ios.label`, `Color.ios.systemGroupedBackground`, … and `Color.android.dynamic.*` / `Color.android.material.*`. Don't feed these into Reanimated styles **[S]**.

---

## 6. react-native-maps 1.29.11 (Apple Maps / `PROVIDER_DEFAULT`) **[V]** `dist/src/*.d.ts`, `ios/AirMaps/*`

MapView props relevant on iOS:
```ts
mapType?: 'standard' | 'mutedStandard' | 'satellite' | 'hybrid' | 'terrain' | 'satelliteFlyover' | 'hybridFlyover' | 'none'
userInterfaceStyle?: 'light' | 'dark'           // force dark map under dark glass
showsTraffic?, showsBuildings?, showsCompass? (adaptive on iOS), showsScale? (Apple only), showsUserLocation?, followsUserLocation?
showsPointsOfInterests?: boolean; pointsOfInterestFilter?: MKPointOfInterestCategoryType[]   // e.g. ['publicTransport'] — filter wins over the boolean
tintColor?: string                              // user-location dot (Apple only)
mapPadding?: { top, right, bottom, left }       // shift camera center/legal label above sheet & tab bar
legalLabelInsets?, appleLogoInsets? (Apple only), compassOffset?
cameraZoomRange?: { minCenterCoordinateDistance?, maxCenterCoordinateDistance?, animated? }   // iOS 13+
pitchEnabled?, rotateEnabled?, scrollEnabled?, zoomEnabled?, camera?, initialCamera?, region?, initialRegion?
onRegionChange / onRegionChangeStart / onRegionChangeComplete(region, details), onPanDrag, onUserLocationChange, onMarkerPress, onPress, onLongPress, onPoiClick
// toolbarEnabled: Android only (no effect on iOS). showsMyLocationButton: Google/Android only.
```
Methods: `animateCamera(Partial<Camera>, { duration? })`, `setCamera`, `getCamera()`, `animateToRegion(region, ms)`, `fitToCoordinates(coords, { edgePadding, animated })`, `fitToSuppliedMarkers`, `pointForCoordinate`, `coordinateForPoint`, `getMarkersFrames`, `takeSnapshot`, `addressForCoordinate`. `Camera = { center, heading, pitch, altitude? (Apple), zoom? (Google) }`.

Polyline: `coordinates`, `strokeColor`, `strokeWidth`, `strokeColors?: string[]` (**must equal `coordinates.length`** → per-vertex gradient, e.g. color by delay/occupancy), `lineDashPattern?: number[]` (Apple OK — scheduled/ghost path), `lineDashPhase?`, `lineCap?`, `lineJoin?`, `tappable?`, `onPress?`, `zIndex?`. `geodesic` is Google-only on iOS.

Marker (Apple-specific): `displayPriority?` (required/high/low → declutter), `titleVisibility?`, `subtitleVisibility?: 'hidden'|'adaptive'|'visible'`, `useLegacyPinView?`, `flat?`, `anchor?`, `centerOffset?`, `calloutAnchor?`, `rotation?`, `isPreselected?`, `identifier?`. Custom child views render as live UIViews; **`tracksViewChanges` is a no-op on Apple Maps** (Google-only) — so animated children (pulsing dots, glass) cost real per-frame work for every marker **[V that prop is Google-only; perf consequence U]**.

Gotchas (from app code comments in `app/map.tsx`):
- MapKit anchors auto-shown callouts at tap-time screen position and doesn't re-anchor during `animateToRegion` → app hides callout (opacity 0), pans, then re-shows. 
- Rapid in-place prop updates of `Polyline.coordinates` + many `Circle`s under Fabric crashed (observed on 1.27.2) → app unmounts route children while static data is stale.
- `MarkerAnimated` unmount during an in-flight `AnimatedRegion` timing animation → Fabric recycle SIGABRT; app calls `stopAnimation()` first.
- Glass over a live map: each `UIGlassEffect`/SwiftUI glass samples the moving map every frame. Keep the number of separate glass surfaces small; group adjacent controls in one `GlassContainer`/`GlassEffectContainer` **[U — perf not measured]**.

Not available via react-native-maps (would need a native module): MapKit `MKMapItem` "look around", iOS 17+ `MapStyle.standard(elevation:.realistic, emphasis:.muted)`, `MapUserLocationButton`/`MapCompass` SwiftUI controls, `selectionAccessory`. **[V by absence in types]**

---

## 7. expo-symbols 58.0.4 **[V]** `build/SymbolModule.types.d.ts`
```ts
<SymbolView
  name: SFSymbol | { ios?: SFSymbol; android?: AndroidSymbol; web?: AndroidSymbol }   // cross-platform names!
  type?: 'monochrome' | 'hierarchical' | 'palette' | 'multicolor'
  colors?: ColorValue | ColorValue[]       // palette layers
  tintColor?: ColorValue
  weight?: 'unspecified'|'ultraLight'|'thin'|'light'|'regular'|'medium'|'semibold'|'bold'|'heavy'|'black' | { ios, android }
  scale?: 'default'|'unspecified'|'small'|'medium'|'large'
  size?: number; resizeMode?: ContentMode; fallback?: ReactNode
  animationSpec?: { effect?: { type: 'bounce'|'pulse'|'scale'; wholeSymbol?: boolean; direction?: 'up'|'down' };
                    repeating?: boolean; repeatCount?: number; speed?: number;
                    variableAnimationSpec?: { reversing?, nonReversing?, cumulative?, iterative?, hideInactiveLayers?, dimInactiveLayers? } }
/>
```
Android/web render Material Symbols when `name.android`/`name.web` is given; `unstable_getMaterialSymbolSourceAsync` exported. For `wiggle`/`breathe`/`rotate`/`drawOn`/`replace`-style content transitions, use `@expo/ui` `Image` + `symbolEffect()` instead (§2.4). `variableValue` (0..1, e.g. signal strength/occupancy) is on `@expo/ui` `Image`, not `SymbolView`.

Useful transit symbols: `bus.fill`, `bus.doubledecker.fill`, `tram.fill`, `figure.walk`, `signpost.right.fill`, `mappin.and.ellipse`, `location.fill`, `scope`, `dot.radiowaves.left.and.right` (live; animate `variableColor`), `clock.badge.exclamationmark`, `bell.badge`, `star.fill`, `arrow.triangle.turn.up.right.diamond.fill`, `person.2.fill`/`person.3.fill` (occupancy).

---

## 8. react-native-reanimated 4.7.1 **[V]** `lib/typescript/*`

CSS transitions (state-driven, no shared values):
```tsx
import Animated, { cubicBezier } from 'react-native-reanimated';
<Animated.View style={{
  transform: [{ scale: pressed ? 0.97 : 1 }],
  transitionProperty: 'transform',            // or ['transform','opacity'] / 'all'
  transitionDuration: 120,                    // ms number or '120ms'
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),  // raw 'cubic-bezier()' strings rejected [S]
  transitionBehavior?: …, transitionDelay?: …
}} />
```
CSS animations (keyframes, loops, on-mount):
```tsx
import Animated, { css } from 'react-native-reanimated';
const pulse = css.keyframes({ from: { opacity: 0.35, transform: [{ scale: 0.9 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } });
<Animated.View style={{ animationName: pulse, animationDuration: '1.2s', animationIterationCount: 'infinite', animationDirection: 'alternate' }} />
// inline object keyframes also accepted: animationName: { '0%': {...}, '100%': {...} }
// exports: css.create, css.keyframes, cubicBezier, linear, steps, createCSSAnimatedComponent
```
**Native pseudo-selectors (new):** style values can be `{ default: X, ':active': Y }` with native keys `':active' | ':active-deepest' | ':hover' | ':focus' | ':focus-within'` → press feedback without React state **[V types + native manager; runtime semantics U]**:
```tsx
<Animated.View style={{ transform: { default: [{ scale: 1 }], ':active': [{ scale: 0.97 }] }, transitionProperty: 'transform', transitionDuration: 120 }} />
```
(iOS warns if `opacity < 0.01` because the view can't be hit-tested.)

Layout animations: `FadeIn/Out[Up|Down|Left|Right]`, `SlideIn/Out*`, `ZoomIn/Out*`, `BounceIn/Out*`, `FlipIn/Out*`, `StretchIn/Out*`, `LightSpeed*`, `Pinwheel*`, `Roll*`, `Rotate*`, `Keyframe`, transitions `LinearTransition`, `FadingTransition`, `SequencedTransition`, `JumpingTransition`, `CurvedTransition`, `EntryExitTransition`; `LayoutAnimationConfig` (skip on mount), `ReducedMotionConfig`, `useReducedMotion`, `ReduceMotion.System`. Build builders at module scope or `useMemo` **[S]**. `Animated.FlatList itemLayoutAnimation={LinearTransition}` for reflow.

Worklets: `scheduleOnRN` (from `react-native-worklets`) replaces deprecated `runOnJS`; use `.get()/.set()` on shared values **[S]**. Spring with `{ duration, dampingRatio }` form.

Shared element: `SharedTransition`, `SharedTransitionBoundary({ isActive })` exported but behind static flag `ENABLE_SHARED_ELEMENT_TRANSITIONS: false` (requires native rebuild with flag) **[V]** → use `Link.AppleZoom`.

Gestures: `react-native-gesture-handler` 3.0.0 is only hoisted; add it to `apps/mobile/package.json` (`npx expo install`) and wrap root in `GestureHandlerRootView` before using `Gesture.*` / v3 hook API **[V presence; config S]**.

---

## 9. expo-haptics **[V]**
`selectionAsync()`, `impactAsync(ImpactFeedbackStyle.Light|Medium|Heavy|Soft|Rigid)`, `notificationAsync(NotificationFeedbackType.Success|Warning|Error)`, `performAndroidHapticsAsync(AndroidHaptics.*)`. App wraps in `components/tracker/haptics.ts` (`safeImpact`). One haptic per user action, same frame as the visual **[S]**. Native SwiftUI `Toggle`/`Picker`/`Slider` already emit haptics.

---

## 10. expo-widgets 58.0.21 — Live Activities / widgets **[V]** `build/Widgets*.d.ts`
```ts
import { createLiveActivity, createWidget, addUserInteractionListener, addPushToStartTokenListener, widgetsDirectory } from 'expo-widgets';
const Factory = createLiveActivity<Props>('BusArrival', (props, env) => { 'widget';
  return { banner, bannerSmall?, compactLeading?, compactTrailing?, minimal?, expandedLeading?, expandedTrailing?, expandedCenter?, expandedBottom? };
});
const activity = Factory.start(props, url?, staleDate?);   // LiveActivity<T>
await activity.update(props, staleDate?); await activity.end('default'|'immediate'|after(date), props?, contentDate?);
activity.getPushToken(); activity.addPushTokenListener(cb); Factory.getInstances();
// env: { colorScheme, isLuminanceReduced?, isActivityFullscreen?, isStale?, isActivityUpdateReduced?, activityFamily?: 'small'|'medium', levelOfDetail? }
```
Layout is built from `@expo/ui/swift-ui` views + modifiers. **Gotcha (app comment, `activities/BusArrivalActivity.tsx`):** the `'widget'` function is serialized at build time; only `@expo/ui/swift-ui` + modifiers + React/jsx-runtime identifiers exist at runtime → inline all helpers/constants. Use `Text date/dateStyle="timer"`, `Text timerInterval`, `ProgressView timerInterval` so the island ticks without updates (app already uses `ProgressView timerInterval` lines 368/605). `activityBackgroundTint(color)` and `widgetURL(url)` modifiers exist. `env.isStale` lets the layout gray out when `staleDate` passes. `Button target="..."` + `addUserInteractionListener` for interactive buttons. `app.json` plugin currently `enablePushNotifications: false` (no remote updates/push-to-start).

---

## 11. Current app usage — patterns & gotchas observed

- Root tabs: `app/_layout.tsx` NativeTabs (deprecated import path), `minimizeBehavior="onScrollDown"`, `DynamicColorIOS` tint, `hidden` toggled by pathname for the toolbar demo, wrapped in `ThemeProvider` (prevents header button flicker). Tabs: `(tracker)`, `map`, `liquid-glass-demo`, `settings`.
- Map FABs (`components/map/{MapModeButton,RecenterStopButton,RecenterRouteButton,MapLegendButton}.tsx`, `RouteSwitcher.tsx`): RN `Pressable` wrapping `<Host matchContents><HStack modifiers={[frame(44×44), glassEffect({glass:{variant:'regular',interactive:true}, shape:'circle'})]}>`. Pressed state is RN opacity 0.85 on the Pressable (= opacity on a glass ancestor; also double feedback with `interactive` glass). Positioned with `SafeAreaView edges={['top']}` absolute stacks — i.e. a hand-built header over the map. No iOS < 26 fallback surface.
- `GlassGuard` (expo-glass-effect + BlurView fallback) used for legend/status cards with `overflow:'hidden'` + `boxShadow` + scrim on the glass — contradicts "never overflow hidden on GlassView" **[S]**; cards are wrapped in `Animated.View entering={FadeIn}` (opacity on glass ancestor — works since 58.0.2 fix but discouraged).
- Sheets: `MapModesSheet`, `TripStopsSheet`, `StopPickerSheet` use swift-ui `BottomSheet` inside `<Host matchContents style={{position:'absolute', width}}>` with `Group` + `presentationDetents/DragIndicator/BackgroundInteraction`. `MapModesSheet` hand-paints ring/gap fills assuming the sheet base is `#1C1C1E` (breaks in light mode / glass).
- `(tracker)/add-bus` formSheet uses opaque `#1C1C1E` contentStyle → not glass.
- `MapModesSheet.tsx:144`: "@expo/ui 58 splits fixed vs flexible frame; pin height via min/max" — `frame()` overloads can't mix `height` with `maxWidth`.
- `settings-sheet-stack-demo-sheet/account.tsx`: experiment whether a SwiftUI `Form` in a `Host` is discovered as the content scroll view for `scrollEdgeEffects` **[U result]**.
- Live Activity in `activities/BusArrivalActivity.tsx` + `hooks/useBusLiveActivity.ts` (see §10).
- NativeWind 4 is installed; `className` works on RN views only, never on `@expo/ui` SwiftUI views (they style via `modifiers`) **[U — inferred from API surface]**.

---

## 12. Recommended building blocks for a transit app

| UI need | Primary API (iOS 26) | Fallback (iOS < 26 / Android) | Notes |
|---|---|---|---|
| **Floating glass bottom sheet over the map** (stop/bus details, peeking "next bus") | Option A — route sheet: `presentation:'formSheet'`, `sheetAllowedDetents:[0.18,0.5,1]`, `sheetLargestUndimmedDetentIndex:1`, `contentStyle:{backgroundColor:'transparent'}`, `sheetGrabberVisible`, `gestureEnabled:false` for a persistent sheet; listen to `sheetDetentChange` to drive `mapPadding.bottom`. Option B — in-screen: swift-ui `BottomSheet` + `presentationDetents([{height:120},'medium','large'])` + `presentationBackgroundInteraction({type:'enabledUpThrough',detent:'medium'})` + `interactiveDismissDisabled()` | Same APIs render a standard material sheet on iOS 17–18; Android formSheet ≤3 detents | Both cover the NativeTabs tab bar while presented (modal) **[U exact iOS 26 behavior]**. If the tab bar must stay visible, use `NativeTabs.BottomAccessory` for the peek state and open the sheet on tap. |
| **Glass tab bar** | `NativeTabs` from `expo-router/native-tabs`, `minimizeBehavior="onScrollDown"`, `role="search"` last tab for stop/route search, `Trigger.Badge` for alerts, `sf={{default, selected}}` + `md` | classic UITabBar / Material nav | Don't style background (ignored on 26). Never build a custom floating pill bar. |
| **"Now playing" style next-bus strip** | `NativeTabs.BottomAccessory` + `usePlacement()` → inline: route chip + `Text dateStyle="timer"`; regular: chip + stop name + countdown | not rendered < 26 → show an in-screen card | Two instances mount; state from context/store. |
| **Glass toolbar buttons over the map** | Convert map tab to a Stack (`app/(map)/_layout.tsx`), `headerTransparent`, `Stack.Toolbar placement="right"` with `Stack.Toolbar.Button icon="location.fill"` / `Stack.Toolbar.Menu icon="square.3.layers.3d"` (map type, traffic toggle via `MenuAction isOn`) — system groups them in shared glass; `separateBackground` to split | Stack header bar buttons (classic) | Free a11y, sizing, glass grouping, no Host per button. For free-floating controls not in a bar, use a single `Host` + `GlassEffectContainer` cluster of `Button`s with `buttonStyle('glass')`, `buttonBorderShape('circle')`, + fallback `background({type:'material',material:'regular'}, shapes.circle())`. |
| **Route chips / route switcher** | `Host matchContents` + `Menu` (label = `HStack` with `glassEffect({shape:'capsule', glass:{interactive:true, tint: routeColor}})`), items `Button systemImage`; or a horizontal `ScrollView axes="horizontal"` of chips; selection via `Picker` + `pickerStyle('segmented'|'palette')` for ≤4 | same views, no glass → add `background(material, shapes.capsule())` | Tint per route color; keep chip text `font({textStyle:'subheadline', weight:'semibold'})` for Dynamic Type. |
| **Stop list** | Long/unknown length: one `Host` + `List` + `List.ForEach data keyExtractor` (recycled) + `listStyle('insetGrouped')` + `SwipeActions` (favourite/hide) + `ContextMenu`; or RN `FlatList` rows with `Link` + `Link.Preview`/`Link.Menu` for peek & actions. Empty: `ContentUnavailableView` | Universal `List` (non-virtualized) only for short fixed groups | Never a `Host` per FlatList row; no `entering` on virtualized rows. |
| **Countdown hero** | `Text date={arrival} dateStyle="timer"` or `timerInterval` + `font({size:96, weight:'bold', design:'rounded'})` + `monospacedDigit()` + `contentTransition('numericText',{countsDown:true})`; status icon `Image systemName="dot.radiowaves.left.and.right"` + `symbolEffect({effect:'variableColor', fillStyle:'iterative'}, {isActive})`; trip progress `ProgressView timerInterval` or `Gauge gaugeStyle('linearCapacity')` | identical (iOS 16+/17+) | Native ticking = zero JS timers/re-renders. RN alternative: Reanimated CSS transition on the number + `fontVariant:['tabular-nums']`. |
| **Map route styling** | `Polyline strokeColors` (per-vertex delay gradient), dashed `lineDashPattern` for scheduled/ghost; `mapType="mutedStandard"` so glass + route colors pop; `pointsOfInterestFilter={['publicTransport']}`; `userInterfaceStyle` follow app theme; `mapPadding` = sheet height + tab bar | same on iOS < 26 | `tracksViewChanges` ineffective on Apple — keep custom marker views static/light. |
| **Live bus marker** | `Marker` custom view (SymbolView `bus.fill` rotated by bearing), `AnimatedRegion` for movement, `displayPriority="required"` for selected bus | — | Stop `AnimatedRegion` animations before unmount (app comment). |
| **Detail navigation** | `Link` + `Link.Trigger withAppleZoom` from bus card → bus detail; `Link.AppleZoomTarget` on detail hero; `Link.Preview` for long-press peek | push transition | iOS 18+; Stack only. |
| **Settings** | `Host useViewportSizeMeasurement` + `Form` + `Section` + `Toggle` / `Picker` / `Stepper` / `LabeledContent` | same | Already the app's pattern in `app/settings.tsx`. |
| **Live Activity / Dynamic Island** | `expo-widgets` `createLiveActivity` with `Text timerInterval`, `ProgressView timerInterval`, `activityBackgroundTint`, `widgetURL`, `env.isStale`, `env.activityFamily` | n/a (iOS only) | Inline everything in the `'widget'` fn. |
| **Press feedback on RN surfaces** | Reanimated CSS transition or `':active'` pseudo style, scale 0.97 / 120 ms; rows highlight instead of scale | — | Don't layer RN opacity press on top of interactive glass. |
| **Loading skeletons** | `redacted('placeholder')` on SwiftUI subtrees | RN skeleton (existing `components/shared/Skeleton.tsx`) | — |

---

## 13. Unverified / needs device testing
- Exact iOS 26 rendering of formSheet glass with `contentStyle: transparent` vs `sheetCornerRadius` set (skill claim; not in types).
- Whether a presented formSheet / SwiftUI sheet leaves the NativeTabs glass bar visible.
- `Stack.Toolbar placement="bottom"` coexisting with the floating NativeTabs bar.
- Reanimated `':active'` pseudo-selector semantics on native (which view receives the press state; interplay with `Pressable`).
- Per-frame cost of many glass surfaces / animated marker subviews over MKMapView.
- Cost of many `Host`s inside a `FlatList`.
- `scrollEdgeEffects` discovering a SwiftUI `Form`/`List` inside a `Host` as the content scroll view (app experiment in `account.tsx`).
- NativeWind `className` on `@expo/ui` components (assumed unsupported).

Source files consulted (installed): `node_modules/@expo/ui/build/{universal,swift-ui}/**/*.d.ts`, `@expo/ui/ios/Modifiers/{GlassEffectModifier,SymbolEffectModifier,ViewModifierRegistry}.swift`, `@expo/ui/CHANGELOG.md`; `expo-glass-effect/build/*.d.ts`, `ios/{GlassView,GlassEffectModule}.swift`; `expo-router/build/{native-tabs,unstable-native-tabs,layouts/StackClient,layouts/stack-utils/**,link/**,react-navigation/native-stack/types,color}.d.ts`; `react-native-maps/dist/src/{MapView,MapView.types,MapMarker,MapPolyline,sharedTypes}.d.ts`, `ios/AirMaps/RNMapsMapView.mm`; `expo-symbols/build/SymbolModule.types.d.ts`; `react-native-reanimated/lib/typescript/{index,css/**,component/SharedTransitionBoundary}.d.ts`, `src/featureFlags/staticFeatureFlags.ts`, `src/css/native/managers/*`; `expo-widgets/build/Widgets*.d.ts`; `expo-blur/build/BlurView.types.d.ts`; `expo-haptics/build/Haptics*.d.ts`; `react-native-screens/ios/RNSScreen.mm`.
