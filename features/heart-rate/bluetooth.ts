/** Local structural types: Web Bluetooth is not in TypeScript's standard DOM lib. */
export interface HeartRateCharacteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<HeartRateCharacteristic>;
  stopNotifications(): Promise<HeartRateCharacteristic>;
}

export interface HeartRateService {
  getCharacteristic(name: "heart_rate_measurement"): Promise<HeartRateCharacteristic>;
}

export interface HeartRateGattServer {
  readonly connected: boolean;
  connect(): Promise<HeartRateGattServer>;
  disconnect(): void;
  getPrimaryService(name: "heart_rate"): Promise<HeartRateService>;
}

export interface HeartRateDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: HeartRateGattServer;
}

export interface HeartRateBluetooth {
  requestDevice(options: { filters: { services: ["heart_rate"] }[] }): Promise<HeartRateDevice>;
}

export function getHeartRateBluetooth(): HeartRateBluetooth | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const bluetooth = (navigator as Navigator & { bluetooth?: HeartRateBluetooth }).bluetooth;
  return typeof bluetooth?.requestDevice === "function" ? bluetooth : null;
}
