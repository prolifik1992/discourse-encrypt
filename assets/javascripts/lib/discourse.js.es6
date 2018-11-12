import {
  exportPublicKey,
  importKey
} from "discourse/plugins/discourse-encrypt/lib/keys";
import { loadKeyPairFromIndexedDb } from "discourse/plugins/discourse-encrypt/lib/keys_db";

/**
 * Possible states of the encryption system.
 *
 * @var ENCRYPT_DISBLED User does not have any generated keys
 * @var ENCRYPT_ENABLED User has keys, but only on server
 * @var ENCRYPT_ACTIVE  User has imported server keys into browser
 */
export const ENCRYPT_DISBLED = 0;
export const ENCRYPT_ENABLED = 1;
export const ENCRYPT_ACTIVE = 2;

/**
 * @var User's private key used to decrypt topic keys.
 */
let privateKey;

/**
 * @var Dictionary of all topic keys (topic_id => key).
 */
const topicKeys = {};

/**
 * Gets user's private key.
 *
 * @return CryptoKey
 */
export function getPrivateKey() {
  if (privateKey) {
    return Promise.resolve(privateKey);
  }

  return loadKeyPairFromIndexedDb().then(keyPair => (privateKey = keyPair[1]));
}

/**
 * Puts a topic key into storage.
 *
 * If there is a key in the store already, it will not be overwritten.
 *
 * @param topicId
 * @param key
 */
export function putTopicKey(topicId, key) {
  if (topicId && key && !topicKeys[topicId]) {
    topicKeys[topicId] = key;
  }
}

/**
 * Gets a topic key from storage.
 *
 * The returned key will also be a `CryptoKey` object.
 *
 * @param topicId
 *
 * @return CryptoKey
 */
export function getTopicKey(topicId) {
  let key = topicKeys[topicId];

  if (!key) {
    return Promise.reject();
  } else if (key instanceof CryptoKey) {
    return Promise.resolve(key);
  } else {
    return getPrivateKey()
      .then(privKey => importKey(key, privKey))
      .then(topicKey => (topicKeys[topicId] = topicKey));
  }
}

/**
 * Checks if there is a topic key for a topic.
 *
 * @param topicId
 *
 * @return Boolean
 */
export function hasTopicKey(topicId) {
  return !!topicKeys[topicId];
}

/**
 * Checks the encryption status for current user.
 *
 * @return Integer Encryption status
 */
export function getEncryptionStatus() {
  const user = Discourse.User.current();
  if (!user) {
    return Promise.resolve(ENCRYPT_DISBLED);
  }

  const sPubKey = user.get("custom_fields.encrypt_public_key");
  const sPrvKey = user.get("custom_fields.encrypt_private_key");

  if (!sPubKey || !sPrvKey) {
    return Promise.resolve(ENCRYPT_DISBLED);
  }

  return loadKeyPairFromIndexedDb()
    .then(([cPubKey, cPrvKey]) =>
      Promise.all([cPubKey, cPrvKey, cPubKey ? exportPublicKey(cPubKey) : null])
    )
    .then(([cPubKey, cPrvKey, cPubKeyExported]) => {
      if (cPubKey && cPrvKey && sPubKey === cPubKeyExported) {
        return ENCRYPT_ACTIVE;
      } else {
        return ENCRYPT_ENABLED;
      }
    });
}

/**
 * Sets `isEncryptEnabled` and `isEncryptActive` flags on the given component.
 *
 * This function is preferred because it waits for application events from the
 * encryption system.
 *
 * @param component
 */
export function hideComponentIfDisabled(component) {
  let handler = () => {
    getEncryptionStatus().then(newStatus => {
      component.set("isEncryptEnabled", newStatus === ENCRYPT_ENABLED);
      component.set("isEncryptActive", newStatus === ENCRYPT_ACTIVE);
    });
  };

  handler();
  component.appEvents.on("encrypt:status-changed", handler);
  // TODO: Call appEvents.off("encrypt:status-changed").
}
