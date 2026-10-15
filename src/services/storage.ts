import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from './api';

/** On-device key-value storage. Holds only demo data and app preferences in this phase. */
export const deviceStore: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};
