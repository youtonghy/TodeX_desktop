import { normalizeServerUrl, type ConnectionSettings } from '@todex/protocol/todex';
import type { ParsedPairing } from '@todex/protocol/transportCrypto';

type ConnectionPatch = Pick<ConnectionSettings, 'serverUrl' | 'authToken' | 'encryptionProtocol' | 'encryptionPublicKey'>;

/** A public-key-only QR must not erase enrollment credentials for that backend,
 * or carry credentials over to a different backend. */
export function pairingConnectionPatch(current: Pick<ConnectionSettings, 'serverUrl' | 'authToken'>, pairing: ParsedPairing): ConnectionPatch {
  const sameBackend = normalizeServerUrl(current.serverUrl) === normalizeServerUrl(pairing.serverUrl);
  return {
    serverUrl: pairing.serverUrl,
    authToken: pairing.authToken || (sameBackend ? current.authToken : ''),
    encryptionProtocol: pairing.encryptionProtocol,
    encryptionPublicKey: pairing.encryptionPublicKey,
  };
}
