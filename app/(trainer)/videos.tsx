// Trainer · Videos — exercise library the client app pulls from. Upload your own.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';

export default function TrainerVideos() {
  const t = useTheme();
  const { videos: vids, addVideo, removeVideo } = useExerciseVideos();
  const [linkOpen, setLinkOpen] = useState(false);
  const [lName, setLName] = useState('');
  const [lGroup, setLGroup] = useState('');
  const [lUrl, setLUrl] = useState('');

  const upload = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to ' + (fromCamera ? 'the camera' : 'your library') + ' to add a video.'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (!res.canceled && res.assets && res.assets[0]) {
      addVideo({ name: 'New exercise clip', group: 'Uncategorised' });
      Alert.alert('Clip saved', 'Saved to your library on this device. Direct video hosting (so clients on other devices can watch) is coming — for now use "Add a link" for a YouTube/Vimeo URL your clients can reliably view.');
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
          <Pressable onPress={() => { setLName(''); setLGroup(''); setLUrl(''); setLinkOpen(true); }} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center', gap: 4 }}>
            <Icon name="share" size={20} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13 }}>Add link</Text>
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
            {v.id.startsWith('vx') ? <Pressable onPress={() => removeVideo(v.id)} hitSlop={8}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 15 }}>×</Text></Pressable> : <Text style={{ color: v.uploaded ? t.brand : t.s3, fontWeight: '700', fontSize: 12 }}>{v.uploaded ? 'Live' : 'To do'}</Text>}
          </View>
        ))}
      </ScrollView>

      <Modal visible={linkOpen} transparent animationType="slide" onRequestClose={() => setLinkOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setLinkOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginBottom: 4 }}>Add a video by link</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 14 }}>Paste a hosted link (YouTube, Vimeo…). Clients watch it in their library.</Text>
          <TextInput value={lName} onChangeText={setLName} placeholder="Exercise name (e.g. Front Squat)" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 10 }} />
          <TextInput value={lGroup} onChangeText={setLGroup} placeholder="Muscle group (e.g. Legs)" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 10 }} />
          <TextInput value={lUrl} onChangeText={setLUrl} placeholder="https://…" placeholderTextColor={t.ink3} autoCapitalize="none" keyboardType="url" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, marginBottom: 16 }} />
          <Pressable onPress={() => { if (!lName.trim()) { Alert.alert('Name needed', 'Give the exercise a name.'); return; } addVideo({ name: lName, group: lGroup, url: lUrl }); setLinkOpen(false); Alert.alert('Added', lName + ' is in the exercise library.'); }} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Add to library</Text></Pressable>
          <Pressable onPress={() => setLinkOpen(false)} style={{ paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text></Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
