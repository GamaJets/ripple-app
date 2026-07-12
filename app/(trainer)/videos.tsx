// Trainer · Videos — exercise library the client app pulls from. Upload your own.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import { EX_VIDEOS, type ExVideo } from '../../src/lib/trainerMock';

export default function TrainerVideos() {
  const t = useTheme();
  const [vids, setVids] = useState<ExVideo[]>(EX_VIDEOS);
  const [name, setName] = useState('');

  const upload = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your library') + ' to add a video.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) {
      setVids([{ id: 'v' + Date.now(), name: 'New exercise clip', group: 'Uncategorised', dur: '—', uploaded: true }, ...vids]);
      Alert.alert('Video added', 'Your clip is now in the library — assign it to an exercise and clients will see it in their program.');
    }
  };

  const done = vids.filter((v) => v.uploaded).length;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Exercise videos</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>{done} of {vids.length} recorded · clients see these in their program</Text>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
          <Pressable onPress={() => upload(true)} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', gap: 4 }}>
            <Icon name="video" size={20} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Record</Text>
          </Pressable>
          <Pressable onPress={() => upload(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', gap: 4 }}>
            <Icon name="plus" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13 }}>Upload</Text>
          </Pressable>
        </View>

        {vids.map((v) => (
          <View key={v.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 54, height: 40, borderRadius: 8, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              {v.uploaded ? <Icon name="play" size={18} color={t.brand} /> : <Icon name="plus" size={18} color={t.ink3} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{v.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 12 }}>{v.group}{v.uploaded ? ` · ${v.dur}` : ' · not recorded yet'}</Text>
            </View>
            <Text style={{ color: v.uploaded ? t.brand : t.s3, fontWeight: '700', fontSize: 12 }}>{v.uploaded ? 'Live' : 'To do'}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
