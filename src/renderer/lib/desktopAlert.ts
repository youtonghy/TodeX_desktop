import { toast } from '@heroui/react';

export type DesktopAlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type DesktopAlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: DesktopAlertButton[];
};

type AlertListener = (request: DesktopAlertRequest | null) => void;

let nextId = 1;
let listener: AlertListener | null = null;
let current: DesktopAlertRequest | null = null;

export function setDesktopAlertListener(next: AlertListener | null): void {
  listener = next;
  listener?.(current);
}

export function desktopAlert(title: string, message?: string, buttons?: DesktopAlertButton[]): void {
  const actions = (buttons ?? []).filter((button) => button.text);
  if (actions.length <= 1) {
    toast(title, { description: message });
    actions[0]?.onPress?.();
    return;
  }

  current = {
    id: nextId,
    title,
    message,
    buttons: actions,
  };
  nextId += 1;
  listener?.(current);
}

export function dismissDesktopAlert(): void {
  current = null;
  listener?.(null);
}

export function resolveDesktopAlert(button: DesktopAlertButton): void {
  dismissDesktopAlert();
  button.onPress?.();
}
