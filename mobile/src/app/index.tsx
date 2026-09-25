import { Text, View } from 'react-native';
import { formatRM } from '@jep/shared';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>JEP Claims {formatRM(15000)}</Text>
    </View>
  );
}
