// The coach's Business tab: Money and Analytics, one tab with a switch.
//
// The owner ruled on 21 Sep 2026 that the two "kind of depend on each other"
// and belong together, which also brings the coach bar to the board's five
// tabs. They stay two screens (each is thousands of lines and owns its own
// reads); this switch sits under the same header on both and moves between
// them, and the tab bar treats Analytics as part of the Money tab.
import { router } from 'expo-router';
import { Ghost, PageHead, Segmented } from './kit';
import { sp } from '../theme/scale';

export function BusinessHead({ current }: { current: 'money' | 'analytics' }) {
  return (
    <>
      <PageHead title="Business" leading={null}
        trailing={<Ghost icon="search" onPress={() => router.push('/(trainer)/explore')} a11yLabel="Search every screen" />} />
      <Segmented style={{ marginTop: sp.md }} value={current} onChange={() => {}}
        options={[
          { key: 'money', label: 'Money', onPress: current === 'money' ? undefined : () => router.navigate('/(trainer)/money') },
          { key: 'analytics', label: 'Analytics', onPress: current === 'analytics' ? undefined : () => router.navigate('/(trainer)/analytics') },
        ]} />
    </>
  );
}
