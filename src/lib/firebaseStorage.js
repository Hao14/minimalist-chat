import { getStorageLazy } from './firebase.js';

let storageApiPromise = null;

export async function getStorageUploadTools() {
  if (!storageApiPromise) storageApiPromise = import('firebase/storage');
  const [{ getDownloadURL, ref, uploadBytesResumable }, storage] = await Promise.all([
    storageApiPromise,
    getStorageLazy(),
  ]);

  return {
    getDownloadURL,
    storage,
    storageRef: ref,
    uploadBytesResumable,
  };
}
