# The podspec is how a LOCAL Expo module reaches the build at all.
#
# Expo autolinking finds `modules/*/expo-module.config.json` and then asks
# CocoaPods to link the platform code — and CocoaPods needs a podspec to do it.
# Without this file the Swift beside it is never compiled and never linked, so
# `requireOptionalNativeModule('WorkoutActivity')` returns null on a device that
# has every other part of the feature. It fails as a silent no-op rather than as
# an error, which is exactly the shape of bug worth a comment.
# NOT named WorkoutActivity, which is the WIDGET EXTENSION's name.
#
# Both would emit a `WorkoutActivity.swiftmodule` into the same
# Debug-iphonesimulator products directory, and the app then links whichever
# landed there — which was the extension's. The error that produces says
# nothing about a collision:
#
#   compiling for iOS 16.4, but module 'WorkoutActivity' has a minimum
#   deployment target of iOS 18.0
#
# because a widget extension targets iOS 18 and the app targets 16.4. It reads
# like a deployment-target problem and is a naming one.
Pod::Spec.new do |s|
  s.name           = 'WorkoutLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts, updates and ends the workout Live Activity.'
  s.description    = 'A local Expo module wrapping ActivityKit for the lock-screen workout clock.'
  s.author         = 'Repple'
  s.homepage       = 'https://repplefitness.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  # ActivityKit matches a running Activity by the attributes TYPE, so BOTH
  # binaries must compile the identical declaration — the app to request and
  # end one, the extension to draw it.
  #
  # `Attributes.swift` beside this file is a SYMLINK to the widget's copy, and
  # the glob picks it up like any other source. A relative path out of the pod
  # root was tried first and is silently ignored: CocoaPods globs `source_files`
  # from the podspec's own directory and does not traverse above it, so the pod
  # installed cleanly, the file was never compiled, and the app failed with
  # "cannot find 'WorkoutAttributes' in scope" — an error about the type rather
  # than about the missing file.
  #
  # A symlink and not a copy. Two declarations of the same attributes is how
  # they come to disagree about a field, and what that produces is an Activity
  # the app starts and the widget cannot render.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
