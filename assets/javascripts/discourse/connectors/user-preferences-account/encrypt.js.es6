import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { registerHelper } from "discourse-common/lib/helpers";

import {
  exportPrivateKey,
  exportPublicKey,
  generateKeyPair,
  generatePassphraseKey,
  importPrivateKey,
  importPublicKey
} from "discourse/plugins/discourse-encrypt/lib/keys";
import { saveKeyPairToIndexedDb } from "discourse/plugins/discourse-encrypt/lib/keys_db";
import {
  ENCRYPT_DISBLED,
  ENCRYPT_ACTIVE,
  getEncryptionStatus
} from "discourse/plugins/discourse-encrypt/lib/discourse";

// TODO: I believe this should get into core.
// Handlebars offers `if` but no other helpers for conditions, which eventually
// lead to a lot of JavaScript bloat.
registerHelper("or", ([a, b]) => a || b);

export default {
  setupComponent(args, component) {
    getEncryptionStatus().then(status => {
      component.setProperties({
        model: args.model,
        save: args.save,
        /** @var Value of passphrase input.
         *       It should stay in memory for as little time as possible.
         *       Clear it often.
         */
        passphrase: "",
        passphrase2: "",
        /** @var Whether the passphrase input is shown. */
        passphraseInput: false,
        /** @var Whether any operation (AJAX request, key generation, etc.) is
         *       in progress. */
        inProgress: false,
        /** @var Whether the encryption is enabled or not. */
        isEnabled: status !== ENCRYPT_DISBLED,
        /** @var Whether the encryption is active on this device. */
        isActive: status === ENCRYPT_ACTIVE,
        // TOOD: Check out if there is a way to define functions like this in
        //       the `export default` scope.
        passphraseMismatch: function() {
          const passphrase = component.get("passphrase");
          const passphrase2 = component.get("passphrase2");
          return !passphrase || !passphrase2 || passphrase !== passphrase2;
        }.property("passphrase", "passphrase2")
      });
    });
  },

  actions: {
    showPassphraseInput() {
      this.setProperties({
        passphrase: "",
        passphrase2: "",
        passphraseInput: true
      });
    },

    hidePassphraseInput() {
      this.setProperties({
        passphrase: "",
        passphrase2: "",
        passphraseInput: false
      });
    },

    enableEncrypt() {
      this.set("inProgress", true);

      // 1. Generate key pair.
      generateKeyPair()
        // 2. a. Export public key to string.
        // 2. b. Export private key to a string (using passphrase).
        .then(keyPair => {
          const [publicKey, privateKey] = keyPair;

          const passphrase = this.get("passphrase");
          const publicStr = exportPublicKey(publicKey);
          const privateStr = generatePassphraseKey(passphrase).then(
            passphraseKey => exportPrivateKey(privateKey, passphraseKey)
          );

          return Promise.all([keyPair, publicStr, privateStr]);
        })

        // 3. Save keys to server.
        .then(([keyPair, publicStr, privateStr]) => {
          const saveKeys = ajax("/encrypt/keys", {
            type: "PUT",
            data: { public_key: publicStr, private_key: privateStr }
          });

          return Promise.all([keyPair, saveKeys]);
        })

        // 4. Save key pair in local IndexedDb.
        .then(([[publicKey, privateKey]]) =>
          saveKeyPairToIndexedDb(publicKey, privateKey)
        )

        // 5. Reset component status.
        .then(() => {
          this.send("hidePassphraseInput");
          this.setProperties({
            inProgress: false,
            isEnabled: true,
            isActive: true
          });
        });
    },

    activateEncrypt() {
      this.set("inProgress", true);

      const publicStr = this.get("model.custom_fields.encrypt_public_key");
      const privateStr = this.get("model.custom_fields.encrypt_private_key");
      const passphrase = this.get("passphrase");

      // 1. a. Import public key from string.
      // 1. b. Import private from string (using passphrase).
      const importPub = importPublicKey(publicStr);
      const importPrv = generatePassphraseKey(passphrase).then(passphraseKey =>
        importPrivateKey(privateStr, passphraseKey)
      );

      Promise.all([importPub, importPrv])

        // 2. Save key pair in local IndexedDb.
        .then(([publicKey, privateKey]) =>
          saveKeyPairToIndexedDb(publicKey, privateKey)
        )

        // 3. Reset component status.
        .then(() => {
          this.appEvents.trigger("encrypt:status-changed");

          this.send("hidePassphraseInput");
          this.setProperties({
            inProgress: false,
            isEnabled: true,
            isActive: true
          });
        })

        .catch(() => {
          this.set("inProgress", false);
          bootbox.alert(I18n.t("encrypt.preferences.passphrase_invalid"));
        });
    },

    disableEncrypt() {
      this.set("inProgress", true);

      // TODO: Delete client keys.

      ajax("/encrypt/keys", { type: "DELETE" })
        .then(() => {
          this.appEvents.trigger("encrypt:status-changed");
          this.setProperties({
            inProgress: false,
            isEnabled: false,
            isActive: false
          });
        })
        .catch(popupAjaxError);
    }
  }
};
