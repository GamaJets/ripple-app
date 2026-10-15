// InBody Progress — the member's scans as a first-class view: latest vs last
// and first, a trend per headline metric, segmental lean on the body map, and
// history with detail and side-by-side compare. Reached from the Progress tab.
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { PageHead } from '../../src/ui/kit';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { InBodyProgress } from '../../src/ui/InBodyProgress';
import { layout } from '../../src/theme/scale';

export default function InBodyScreen() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const status = cd.scansStatus === 'error' ? 'error' : cd.scansStatus === 'partial' ? 'partial'
    : cd.scansStatus === 'ready' ? 'ready' : 'loading';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 120 }}>
        <PageHead title="InBody Progress" subtitle="Every scan, what moved, and which way" onBack={() => router.back()} />
        <InBodyProgress scans={cd.scans} goal={cd.goal} unit={wu} who="You" status={status}
          onUpload={() => router.push({ pathname: '/(client)/scans', params: { add: 'inbody', at: String(Date.now()) } } as any)} />
      </ScrollView>
    </SafeAreaView>
  );
}
