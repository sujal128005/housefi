import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { KeyValueStore } from './api';

/** On-device key-value storage for preferences and demo data. Not for secrets: it is a plain file. */
export const deviceStore: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};

const SECURE: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock (background refresh), never synced to iCloud Keychain or restored to another device.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Session tokens: the iOS Keychain / Android Keystore-encrypted storage. The web preview has no secure storage, so
 * there it falls back to the plain store (the web build is a review aid, not a product).
 */
export const secretStore: KeyValueStore = Platform.OS === 'web' ? deviceStore : {
  get: (k) => SecureStore.getItemAsync(k, SECURE),
  set: (k, v) => SecureStore.setItemAsync(k, v, SECURE),
  remove: (k) => SecureStore.deleteItemAsync(k, SECURE),
};
