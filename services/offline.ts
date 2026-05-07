import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const QUEUE_KEY = '@offline_queue';

export type QueueItem = {
  id: string; // local uuid
  type: 'CREATE_POLE' | 'CREATE_NAPBOX';
  payload: any;
  status: 'pending' | 'syncing' | 'failed';
  createdAt: number;
};

export const getQueue = async (): Promise<QueueItem[]> => {
  try {
    const q = await AsyncStorage.getItem(QUEUE_KEY);
    return q ? JSON.parse(q) : [];
  } catch {
    return [];
  }
};

export const addToQueue = async (type: QueueItem['type'], payload: any): Promise<string> => {
  const localId = `local_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const item: QueueItem = {
    id: localId,
    type,
    payload,
    status: 'pending',
    createdAt: Date.now(),
  };
  
  const q = await getQueue();
  q.push(item);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  return localId;
};

export const removeFromQueue = async (id: string) => {
  const q = await getQueue();
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.filter(i => i.id !== id)));
};

export const syncQueue = async (token: string) => {
  let q = await getQueue();
  if (q.length === 0) return;

  // Track mapping of local pole IDs to real pole IDs
  const poleIdMap: Record<string, number> = {};

  for (const item of q) {
    if (item.status === 'syncing') continue; // Prevent concurrent syncs for the same item

    try {
      if (item.type === 'CREATE_POLE') {
        const res = await api.request<any>('/poles', {
          method: 'POST',
          body: JSON.stringify(item.payload),
        }, token);
        
        if (res?.data?.id) {
          poleIdMap[item.id] = res.data.id;
        }
        await removeFromQueue(item.id);

      } else if (item.type === 'CREATE_NAPBOX') {
        let payload = { ...item.payload };
        
        // If the napbox references a local pole_id, update it to the real pole_id
        if (typeof payload.pole_id === 'string' && payload.pole_id.startsWith('local_')) {
          if (poleIdMap[payload.pole_id]) {
            payload.pole_id = poleIdMap[payload.pole_id];
          } else {
            // Wait for pole to sync first, skip for now or wait for next tick
            console.warn("Real pole ID not found for local ID", payload.pole_id);
            continue; 
          }
        }

        await api.request<any>('/nap-boxes', {
          method: 'POST',
          body: JSON.stringify(payload),
        }, token);
        
        await removeFromQueue(item.id);
      }
    } catch (e: any) {
      console.error(`Sync failed for ${item.type}:`, e.message);
      // Item remains in queue
    }
  }
};
