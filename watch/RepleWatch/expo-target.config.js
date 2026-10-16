/** Apple Watch companion (scaffold). NOT built yet: it lives outside ./targets
 *  on purpose, because @bacons/apple-targets builds every folder under
 *  ./targets, and a new watch target needs its own bundle id and provisioning
 *  profile before an EAS build can sign it. See docs/WATCH-COMPANION.md for the
 *  steps that move it into ./targets. */
module.exports = {
  type: 'watch',
  name: 'RepleWatch',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI', 'WatchConnectivity'],
};
