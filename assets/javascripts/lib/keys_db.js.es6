/*
 * Checks if this is running in Apple's Safari.
 *
 * Safari's implementation of IndexedDb cannot store CryptoKeys, so JWK's are
 * used instead.
 *
 * TODO: Remove `isSafari`, `exportKey` and `importKey` if Safari was fixed.
 *         - https://bugs.webkit.org/show_bug.cgi?id=177350
 *         - https://bugs.webkit.org/show_bug.cgi?id=182972
 */
const isSafari = !!navigator.userAgent.match(/Version\/(\d+).+?Safari/);

/**
 * Exports a public key.
 *
 * @param key
 *
 * @return String
 */
function exportKey(key) {
  return window.crypto.subtle
    .exportKey("jwk", key)
    .then(jwk => JSON.stringify(jwk));
}

/**
 * Imports a public key.
 *
 * @param key
 *
 * @return CryptoKey
 */
function importKey(key, op) {
  return window.crypto.subtle.importKey(
    "jwk",
    JSON.parse(key),
    {
      name: "RSA-OAEP",
      hash: { name: "SHA-256" }
    },
    true,
    [op]
  );
}

/**
 * Opens plugin's Indexed DB.
 *
 * @return IDBOpenDBRequest
 */
function openIndexedDb() {
  let req = window.indexedDB.open("discourse-encrypt", 1);

  req.onupgradeneeded = evt => {
    let db = evt.target.result;
    if (!db.objectStoreNames.contains("keys")) {
      db.createObjectStore("keys", { keyPath: "id", autoIncrement: true });
    }
  };

  return req;
}

/**
 * Save a key pair to plugin's Indexed DB.
 *
 * @param pubKey
 * @param privKey
 *
 * @return Promise
 */
export function saveKeyPairToIndexedDb(pubKey, privKey) {
  if (isSafari) {
    pubKey = exportKey(pubKey);
    privKey = exportKey(privKey);
  }

  return Promise.all([pubKey, privKey]).then(
    ([publicKey, privateKey]) =>
      new Promise((resolve, reject) => {
        let req = openIndexedDb();

        req.onerror = evt => reject(evt);

        req.onsuccess = evt => {
          let db = evt.target.result;
          let tx = db.transaction("keys", "readwrite");
          let st = tx.objectStore("keys");

          let dataReq = st.add({ publicKey, privateKey });
          dataReq.onsuccess = dataEvt => resolve(dataEvt);
          dataReq.onerror = dataEvt =>
            console.log("Error saving keys.", dataEvt);
        };
      })
  );
}

/**
 * Gets the last stored key-pair from plugin's IndexedDB.
 *
 * @return Array A tuple consisting of public and private key.
 */
export function loadKeyPairFromIndexedDb() {
  return new Promise((resolve, reject) => {
    let req = openIndexedDb();

    req.onerror = evt => reject(evt);

    req.onsuccess = evt => {
      let db = evt.target.result;
      let tx = db.transaction("keys", "readonly");
      let st = tx.objectStore("keys");

      let dataReq = st.getAll();
      dataReq.onsuccess = dataEvt => resolve(dataEvt.target.result);
      dataReq.onerror = dataEvt => console.log("Error loading keys.", dataEvt);
    };
  }).then(keyPairs => {
    if (!keyPairs || keyPairs.length === 0) {
      return [undefined, undefined];
    }

    let keyPair = keyPairs[keyPairs.length - 1];

    if (isSafari) {
      return Promise.all([
        importKey(keyPair.publicKey, "encrypt"),
        importKey(keyPair.privateKey, "decrypt")
      ]);
    }

    return [keyPair.publicKey, keyPair.privateKey];
  });
}
