const fs = require('fs');
function patch(file, anchor, insertAfter) {
  let s = fs.readFileSync(file, 'utf8');
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + file); process.exit(1); }
  s = s.replace(anchor, anchor + insertAfter);
  fs.writeFileSync(file, s);
  console.log('patched ' + file);
}
// 1) register route
patch(
  'app/(client)/_layout.tsx',
  "      <Tabs.Screen name=\"feedback\" options={{ href: null, title: 'Send Feedback' }} />",
  "\n      <Tabs.Screen name=\"referral\" options={{ href: null, title: 'Invite Friends' }} />"
);
// 2) add to client features directory (Coaching & Account area)
patch(
  'src/lib/features.ts',
  "  { key: 'social', label: 'Share & Social', note: 'Post progress to Instagram / TikTok', route: '/(client)/social', icon: 'share', area: 'me', keywords: 'instagram tiktok share' },",
  "\n  { key: 'referral', label: 'Invite Friends', note: 'Share the app with a friend', route: '/(client)/referral', icon: 'share', area: 'me', keywords: 'refer referral invite friend share code' },"
);
