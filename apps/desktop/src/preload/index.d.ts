import type { OsemkaApi } from "../shared/ipc";

declare global {
  interface Window {
    osemka: OsemkaApi;
  }
}
export {};
