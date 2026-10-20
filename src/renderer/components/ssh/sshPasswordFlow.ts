import { loadSshPassword } from '../../lib/sshPasswordStore';
import type { EnteredPassword } from './useRemoteConnector';
import { toast } from '@/components/ui/toast';

export type AskSshPassword = (label: string, sshHost?: boolean) => Promise<EnteredPassword | null>;
export type RememberSshPassword = (alias: string, entered: EnteredPassword) => Promise<void>;

/**
 * Logs in to an SSH host the way terminals and SFTP do: a password host first
 * uses its saved password (or asks for one), and every authentication failure
 * asks again until the user cancels. A password entered with "remember" is
 * saved once an attempt succeeds. Resolves to the last result, or `null` when
 * the user cancelled before the first attempt.
 */
export async function withSshPassword<T>({ backendId, alias, passwordHost, askPassword, rememberPassword, attempt, needsPassword, succeeded, wrongPasswordMessage }: {
  backendId: string;
  alias: string;
  /** Managed host with `authMethod: 'password'`. */
  passwordHost: boolean;
  askPassword: AskSshPassword;
  rememberPassword: RememberSshPassword;
  attempt: (password?: string) => Promise<T>;
  /** The result asks for a (different) password. */
  needsPassword: (result: T) => boolean;
  succeeded: (result: T) => boolean;
  wrongPasswordMessage: string;
}): Promise<T | null> {
  let entered: EnteredPassword | null = null;
  let password: string | undefined;
  if (passwordHost) {
    password = (await loadSshPassword(backendId, alias)) ?? undefined;
    if (!password) {
      entered = await askPassword(alias, true);
      if (!entered) return null;
      password = entered.password;
    }
  }
  for (;;) {
    const result = await attempt(password);
    if (!needsPassword(result)) {
      if (entered && succeeded(result)) await rememberPassword(alias, entered);
      return result;
    }
    if (password !== undefined) toast.danger(wrongPasswordMessage);
    entered = await askPassword(alias, true);
    if (!entered) return result;
    password = entered.password;
  }
}
