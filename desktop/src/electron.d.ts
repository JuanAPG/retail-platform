export {};

declare global {
  interface Window {
    electronAPI: {
      saveSession: (token: string) => Promise<void>;
      getSession: () => Promise<string | null>;
      clearSession: () => Promise<void>;
    };
  }
}
