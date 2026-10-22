// Small client for the optional server. Every call fails soft: the app keeps working
// on this phone when the server is unreachable or the user is not signed in.

const BASE = "/api";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

export interface Me { id: string; name: string; email: string; role: string }

export const me = () => call<Me>("/auth/me");
export const signIn = (email: string, password: string) => call<Me>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const signUp = (name: string, email: string, password: string) =>
  call<Me>("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password, role: "caregiver" }) });
export const signOut = () => call<{ ok: true }>("/auth/logout", { method: "POST" });

export const exportAccount = () => call<unknown>("/account/export");
/** Hard-deletes the account, its rows and push subscriptions on the server. */
export const deleteAccount = () => call<{ ok: true }>("/account/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) });

/** Tell the caregiver's devices (Web Push) that the elder may need help. */
export const notifyCaregiver = (elderId: string, text: string) =>
  call<{ sent: number }>("/notify", { method: "POST", body: JSON.stringify({ elder_id: elderId, text }) });

export async function enablePush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const { key } = await call<{ key: string | null }>("/push/key");
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await call("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return true;
}
