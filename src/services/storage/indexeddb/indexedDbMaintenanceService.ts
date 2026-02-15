export const resetLocalDatabase = async (): Promise<void> => {
  try {
    const dbs = await window.indexedDB.databases();
    for (const dbInfo of dbs) {
      if (dbInfo.name) {
        window.indexedDB.deleteDatabase(dbInfo.name);
      }
    }
  } catch (error) {
    console.error('Failed to clear IndexedDB databases:', error);
  }

  localStorage.clear();
  sessionStorage.clear();
  window.location.reload();
};
