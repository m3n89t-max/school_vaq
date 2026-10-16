export type Room = 'kitchen' | 'washing';
export type Status = 'veryGood' | 'good' | 'normal' | 'bad' | 'veryBad';

export interface MetricData {
  pm10: number;
  pm25: number;
  co2: number;
  voc: number;
  formaldehyde: number;
  co: number;
  temperature: number;
  humidity: number;
}

export interface FanControl {
  running: boolean;
  speed: number;
}

export interface RoomFans {
  supply: FanControl;
  exhaust: FanControl;
}

export interface FansData {
  kitchen: RoomFans;
  washing: RoomFans;
}

export interface FridgeItem {
  temp: number;
  status: string;
}

export interface FridgeData {
  fridge1: FridgeItem;
  fridge2: FridgeItem;
  freezer1: FridgeItem;
  freezer2: FridgeItem;
}

export interface RoomData {
  kitchen: MetricData;
  washing: MetricData;
  fans?: FansData;
  fridge?: FridgeData;
}

export interface MetricHistory {
  id: number;
  room: string;
  metric_name: string;
  value: number;
  timestamp: number;
}

export interface FanState {
  supply: { on: boolean; speed: number };
  exhaust: { on: boolean; speed: number };
}

export interface FridgeState {
  temp: number;
  status: 'normal' | 'warning' | 'alarm';
  alarm?: string;
}

export interface DashboardState {
  kitchen: MetricData;
  washing: MetricData;
  kitchenFan: FanState;
  washingFan: FanState;
  fridge: FridgeState;
  freezer: FridgeState;
}
