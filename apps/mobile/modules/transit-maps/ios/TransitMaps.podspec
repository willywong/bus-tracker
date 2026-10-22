Pod::Spec.new do |s|
  s.name           = 'TransitMaps'
  s.version        = '0.1.0'
  s.summary        = 'MapKit place search, walking paths, Look Around and map snapshots'
  s.description    = 'Local Expo module wrapping keyless Apple MapKit services for BusBuddy.'
  s.author         = 'Willy Wong'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '6.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MapKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
