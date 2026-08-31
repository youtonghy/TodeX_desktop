export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await window.todexDesktop.store.get(key);
    if (value === null || value === undefined) {
      return fallback;
    }
    return value as T;
  } catch {
    return fallback;
  }
}

export async function saveJson<T>(key: string, value: T): Promise<void> {
  await window.todexDesktop.store.set(key, value);
}

export async function loadSecret(key: string): Promise<string> {
  const value = await window.todexDesktop.store.get(key);
  return typeof value === 'string' ? value : '';
}

export async function saveSecret(key: string, value: string): Promise<void> {
  if (value) {
    await window.todexDesktop.store.set(key, value);
    return;
  }
  await window.todexDesktop.store.set(key, undefined);
}
