Pod::Spec.new do |s|
  s.name           = 'BusModel'
  s.version        = '0.1.0'
  s.summary        = 'A RealityKit 3D bus with a live headsign'
  s.description    = 'Local Expo module drawing the RapidKL bus on a turntable for BusBuddy.'
  s.author         = 'Willy Wong'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '6.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'RealityKit', 'Combine'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  # Built by scripts/build-feeder-bus.py; see that script for the asset contract.
  s.resource_bundles = { 'BusModelAssets' => ['Assets/*.{usdz,png}'] }
end
