import { normalizeServerUrl, type ConnectionSettings } from '@todex/protocol/todex';
import type { ParsedPairing } from '@todex/protocol/transportCrypto';

type ConnectionPatch = Pick<ConnectionSettings, 'serverUrl' | 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey'>;

/** A public-key-only QR must not erase the device enrollment for that backend,
 * or carry device credentials over to a different backend. */
export function pairingConnectionPatch(current: Pick<ConnectionSettings, 'serverUrl' | 'deviceSecret'>, pairing: ParsedPairing): ConnectionPatch {
  const sameBackend = normalizeServerUrl(current.serverUrl) === normalizeServerUrl(pairing.serverUrl);
  return {
    serverUrl: pairing.serverUrl,
    deviceSecret: sameBackend ? current.deviceSecret : '',
    encryptionProtocol: pairing.encryptionProtocol,
    encryptionPublicKey: pairing.encryptionPublicKey,
  };
}
