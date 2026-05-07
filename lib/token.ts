/**
 * Token store backed by expo-file-system/legacy (no native linking needed).
 * In-memory cache for speed; file for persistence across app restarts.
 */
import * as FileSystem from "expo-file-system/legacy";

const STORE_DIR   = FileSystem.documentDirectory + "auth-store/";
const TOKEN_FILE  = STORE_DIR + "token.txt";
const USER_FILE   = STORE_DIR + "user.json";
const CREDS_FILE  = STORE_DIR + "creds.json";
const INSTALL_FLAG = STORE_DIR + "install.flag";

let _token: string | null = null;
let _user: any = null;

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(STORE_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(STORE_DIR, { intermediates: true });
  } catch { /* ignore */ }
}

async function readFile(path: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch { return null; }
}

async function writeFile(path: string, value: string): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(path, value);
  } catch { /* keep in-memory value */ }
}

async function deleteFile(path: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) await FileSystem.deleteAsync(path);
  } catch { /* ignore */ }
}

export const tokenStore = {
  set: async (token: string): Promise<void> => {
    _token = token;
    await writeFile(TOKEN_FILE, token);
  },

  get: async (): Promise<string | null> => {
    if (_token) return _token;
    const saved = await readFile(TOKEN_FILE);
    if (saved) _token = saved;
    return _token;
  },

  setUser: async (user: any): Promise<void> => {
    _user = user;
    await writeFile(USER_FILE, JSON.stringify(user));
  },

  getUser: async (): Promise<any> => {
    if (_user) return _user;
    const saved = await readFile(USER_FILE);
    if (saved) {
      try { _user = JSON.parse(saved); } catch { /* ignore */ }
    }
    return _user;
  },

  clear: async (): Promise<void> => {
    _token = null;
    _user  = null;
    await deleteFile(TOKEN_FILE);
    await deleteFile(USER_FILE);
  },

  isLoggedIn: async (): Promise<boolean> => {
    const token = await tokenStore.get();
    return !!token;
  },

  isNewInstall: async (): Promise<boolean> => {
    const flag = await readFile(INSTALL_FLAG);
    return !flag;
  },

  markInstalled: async (): Promise<void> => {
    await writeFile(INSTALL_FLAG, "1");
  },

  saveCredentials: async (email: string, password: string): Promise<void> => {
    // Store obfuscated — files are in app-private directory (no root = no read)
    const raw = JSON.stringify({ email, pw: encodeURIComponent(password) });
    await writeFile(CREDS_FILE, raw);
  },

  checkCredentials: async (email: string, password: string): Promise<boolean> => {
    const saved = await readFile(CREDS_FILE);
    if (!saved) return false;
    try {
      const { email: savedEmail, pw } = JSON.parse(saved);
      return savedEmail === email && decodeURIComponent(pw) === password;
    } catch { return false; }
  },
};
