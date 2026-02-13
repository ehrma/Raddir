import { app as c, nativeImage as L, Tray as q, Menu as M, BrowserWindow as T, globalShortcut as v, ipcMain as s, session as C, safeStorage as l, nativeTheme as b, desktopCapturer as j } from "electron";
import { dirname as $, join as u } from "node:path";
import { fileURLToPath as z } from "node:url";
import { writeFileSync as _, existsSync as m, unlinkSync as G, readFileSync as H, mkdirSync as U } from "node:fs";
import { createSign as Q, createPrivateKey as Z, generateKeyPairSync as X } from "node:crypto";
const Y = z(import.meta.url), P = $(Y);
let i = null, S = null, g = null;
function V() {
  return process.env.VITE_DEV_SERVER_URL ? u(P, "../public/raddir-tray-icon.png") : u(P, "../dist/raddir-tray-icon.png");
}
function B() {
  i = new T({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Raddir",
    icon: V(),
    backgroundColor: b.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: !0,
    webPreferences: {
      preload: u(P, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    },
    show: !1
  }), i.once("ready-to-show", () => {
    i == null || i.show();
  }), process.env.VITE_DEV_SERVER_URL ? i.loadURL(process.env.VITE_DEV_SERVER_URL) : i.loadFile(u(P, "../dist/index.html")), i.on("closed", () => {
    i = null;
  });
}
c.on("certificate-error", (t, e, n, r, a, o) => {
  try {
    const y = new URL(n);
    if (g && y.host === g) {
      t.preventDefault(), o(!0);
      return;
    }
  } catch {
  }
  o(!1);
});
c.whenReady().then(() => {
  B();
  const t = L.createFromPath(V()), e = u(c.getPath("temp"), `raddir-tray-${Date.now()}.png`);
  _(e, t.toPNG()), S = new q(e), S.setToolTip("Raddir"), S.setContextMenu(M.buildFromTemplate([
    { label: "Show Raddir", click: () => i == null ? void 0 : i.show() },
    { type: "separator" },
    { label: "Quit", click: () => c.quit() }
  ])), S.on("click", () => i == null ? void 0 : i.show()), c.on("activate", () => {
    T.getAllWindows().length === 0 && B();
  });
});
c.on("window-all-closed", () => {
  process.platform !== "darwin" && c.quit();
});
c.on("will-quit", () => {
  v.unregisterAll();
});
s.handle("register-ptt-key", (t, e) => {
  v.unregisterAll(), e && v.register(e, () => {
    i == null || i.webContents.send("ptt-pressed");
  });
});
s.handle("unregister-ptt-key", () => {
  v.unregisterAll();
});
s.handle("trust-server-host", (t, e) => {
  if (g = e || null, g) {
    const n = g.split(":")[0];
    C.defaultSession.setCertificateVerifyProc((r, a) => {
      if (r.hostname === n) {
        a(0);
        return;
      }
      a(-3);
    });
  } else
    C.defaultSession.setCertificateVerifyProc(null);
});
s.handle("safe-storage-encrypt", (t, e) => l.isEncryptionAvailable() ? l.encryptString(e).toString("base64") : null);
s.handle("safe-storage-decrypt", (t, e) => {
  if (!l.isEncryptionAvailable()) return null;
  try {
    return l.decryptString(Buffer.from(e, "base64"));
  } catch {
    return null;
  }
});
s.handle("get-theme", () => b.shouldUseDarkColors ? "dark" : "light");
s.handle("get-desktop-sources", async () => (await j.getSources({
  types: ["screen", "window"],
  thumbnailSize: { width: 320, height: 180 }
})).map((e) => ({
  id: e.id,
  name: e.name,
  thumbnailDataUrl: e.thumbnail.toDataURL(),
  display_id: e.display_id
})));
let f = null;
function w() {
  const t = u(c.getPath("userData"), "identity");
  return m(t) || U(t, { recursive: !0 }), u(t, "identity.json");
}
function D() {
  if (f) return f;
  const t = w();
  if (!m(t)) return null;
  try {
    const e = JSON.parse(H(t, "utf-8"));
    if (!l.isEncryptionAvailable()) return null;
    const n = l.decryptString(Buffer.from(e.encryptedPrivateKey, "base64"));
    return f = { publicKeyHex: e.publicKeyHex, privateKeyPem: n, algorithm: e.algorithm }, f;
  } catch {
    return null;
  }
}
function A() {
  const { publicKey: t, privateKey: e } = X("ec", {
    namedCurve: "P-256"
  }), n = t.export({ type: "spki", format: "der" }), r = e.export({ type: "pkcs8", format: "pem" }), a = n.toString("hex");
  if (!l.isEncryptionAvailable())
    throw new Error("safeStorage not available — cannot store identity securely");
  const o = l.encryptString(r).toString("base64"), y = {
    publicKeyHex: a,
    encryptedPrivateKey: o,
    algorithm: "ECDSA-P256",
    createdAt: Date.now()
  };
  return _(w(), JSON.stringify(y)), f = { publicKeyHex: a, privateKeyPem: r, algorithm: "ECDSA-P256" }, f;
}
s.handle("identity-get-public-key", () => (D() ?? A()).publicKeyHex);
s.handle("identity-sign", (t, e) => {
  const n = D() ?? A(), r = Q("SHA256");
  r.update(Buffer.from(e, "utf-8")), r.end();
  const a = Z(n.privateKeyPem);
  return r.sign({ key: a, dsaEncoding: "ieee-p1363" }).toString("base64");
});
s.handle("identity-regenerate", () => {
  const t = w();
  return m(t) && G(t), f = null, A().publicKeyHex;
});
s.handle("identity-export", (t, e) => {
  const n = D();
  if (!n) return null;
  const r = require("node:crypto"), a = r.randomBytes(16), o = r.randomBytes(12), y = r.pbkdf2Sync(e, a, 6e5, 32, "sha256"), d = r.createCipheriv("aes-256-gcm", y, o), K = JSON.stringify({ publicKey: n.publicKeyHex, privateKeyPem: n.privateKeyPem, algorithm: n.algorithm }), x = Buffer.concat([d.update(K, "utf-8"), d.final()]), E = d.getAuthTag();
  return JSON.stringify({
    version: 2,
    salt: a.toString("hex"),
    iv: o.toString("hex"),
    data: Buffer.concat([x, E]).toString("hex")
  });
});
s.handle("identity-import-encrypted", (t, e, n) => {
  try {
    const r = JSON.parse(e);
    if (r.version !== 2) return { success: !1, error: "Unsupported identity file version" };
    const a = require("node:crypto"), o = Buffer.from(r.salt, "hex"), y = Buffer.from(r.iv, "hex"), d = Buffer.from(r.data, "hex"), K = d.subarray(d.length - 16), x = d.subarray(0, d.length - 16), E = a.pbkdf2Sync(n, o, 6e5, 32, "sha256"), k = a.createDecipheriv("aes-256-gcm", E, y);
    k.setAuthTag(K);
    const O = Buffer.concat([k.update(x), k.final()]).toString("utf-8"), p = JSON.parse(O);
    if (!p.publicKey || !p.privateKeyPem) return { success: !1, error: "Invalid identity file" };
    if (!l.isEncryptionAvailable()) return { success: !1, error: "Secure storage unavailable" };
    const F = l.encryptString(p.privateKeyPem).toString("base64"), I = {
      publicKeyHex: p.publicKey,
      encryptedPrivateKey: F,
      algorithm: p.algorithm ?? "Ed25519",
      createdAt: Date.now()
    };
    return _(w(), JSON.stringify(I)), f = { publicKeyHex: p.publicKey, privateKeyPem: p.privateKeyPem, algorithm: p.algorithm ?? "Ed25519" }, { success: !0 };
  } catch (r) {
    return { success: !1, error: r.message ?? "Decryption failed" };
  }
});
const h = /* @__PURE__ */ new Map();
function N(t) {
  const e = u(c.getPath("userData"), "identity-pins");
  m(e) || U(e, { recursive: !0 });
  const n = t.replace(/[^a-zA-Z0-9_-]/g, "_");
  return u(e, `${n}.json`);
}
function R(t) {
  const e = h.get(t);
  if (e) return e;
  const n = N(t);
  if (!m(n))
    return h.set(t, {}), {};
  try {
    const r = JSON.parse(H(n, "utf-8"));
    return h.set(t, r), r;
  } catch {
    return h.set(t, {}), {};
  }
}
function J(t, e) {
  h.set(t, e), _(N(t), JSON.stringify(e));
}
s.handle("identity-pin-check", (t, e, n, r) => {
  const a = R(e), o = a[n];
  return o ? o === r ? "ok" : "mismatch" : (a[n] = r, J(e, a), "new");
});
s.handle("identity-pin-get", (t, e, n) => R(e)[n] ?? null);
s.handle("identity-pin-remove", (t, e, n) => {
  const r = R(e);
  delete r[n], J(e, r);
});
b.on("updated", () => {
  i == null || i.webContents.send("theme-changed", b.shouldUseDarkColors ? "dark" : "light");
});
