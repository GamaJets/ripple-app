// Remove the HealthKit *write* declaration from Info.plist.
//
// Repple only ever reads from Apple Health. src/lib/wearables/appleHealth.ts
// requests `write: []`, and there is no HealthKit save call anywhere in the
// codebase. Apple's guidance is that NSHealthUpdateUsageDescription belongs in
// an app that requests write authorisation — declaring a capability the app
// never exercises is a capability claim it cannot substantiate at review.
//
// It could not simply be dropped from app.json. react-native-health's config
// plugin sets the key UNCONDITIONALLY:
//
//   config.modResults.NSHealthUpdateUsageDescription =
//     healthUpdatePermission ||
//     config.modResults.NSHealthUpdateUsageDescription ||
//     HEALTH_UPDATE            <- its own generic default
//
// so removing our string only substitutes theirs. Config plugins are applied
// in the order they appear in `plugins`, and each withInfoPlist mod runs in
// that order, so this one — listed AFTER react-native-health — sees the key
// already set and deletes it.
//
// IF WRITE-BACK IS EVER IMPLEMENTED: delete this plugin from app.json, restore
// `healthUpdatePermission` on the react-native-health entry, and put the
// sentence back in web/privacy.html. All three have to move together; they
// were out of step before, with the policy and the Info.plist both promising a
// feature the code did not have.

const { withInfoPlist } = require('expo/config-plugins');

const withNoHealthWrite = (config) =>
  withInfoPlist(config, (c) => {
    delete c.modResults.NSHealthUpdateUsageDescription;
    return c;
  });

module.exports = withNoHealthWrite;
