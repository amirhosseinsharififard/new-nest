export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedUserIds: number[];
  allowedChatIds: number[];

  topics: {
    scanner: number;
    reports: number;
    positions: number;
    alerts: number;
    status: number;
  };
}

export type TelegramTopic =
  | 'scanner'
  | 'reports'
  | 'positions'
  | 'alerts'
  | 'status';
