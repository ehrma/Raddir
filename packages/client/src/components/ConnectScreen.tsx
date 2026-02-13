import { useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { Shield, Wifi, Plus, Trash2, Server, Settings, Lock, Ticket, Pencil } from "lucide-react";
import { cn } from "../lib/cn";
import { useConnection } from "../hooks/useConnection";
import { SettingsPanel } from "./Settings/SettingsPanel";
import { getOrCreateIdentity } from "../lib/e2ee/identity";
import { normalizeServerUrl } from "../lib/normalize-url";
import logoImg from "../assets/raddir-shield-logo.png";

export function ConnectScreen() {
  const { nickname, savedServers, setServerUrl, setNickname, addServer, removeServer, updateServer, updateServerPassword, updateServerAdminToken } = useSettingsStore();
  const { connect, connecting, error } = useConnection();
  const [selectedId, setSelectedId] = useState<string | null>(savedServers[0]?.id ?? null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAdminToken, setNewAdminToken] = useState("");
  const [editingServer, setEditingServer] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editAdminToken, setEditAdminToken] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const selectedServer = savedServers.find((s) => s.id === selectedId) ?? null;

  const handleConnect = () => {
    if (!nickname.trim() || !selectedServer) return;
    setServerUrl(selectedServer.address);
    setTimeout(() => connect(), 0);
  };

  const handleAddServer = () => {
    if (!newName.trim() || !newAddress.trim()) return;
    addServer(newName.trim(), newAddress.trim(), newPassword.trim() || undefined, newAdminToken.trim() || undefined);
    setNewName("");
    setNewAddress("");
    setNewPassword("");
    setNewAdminToken("");
    setShowAddForm(false);
  };

  const redeemInvite = async () => {
    const code = inviteCode.trim();
    if (!code) return;
    setInviteError(null);
    setRedeeming(true);

    try {
      // Decode the invite blob client-side (base64url → JSON)
      let decoded: { v: number; a: string; t: string };
      try {
        // base64url → standard base64: replace URL-safe chars and add padding
        let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4 !== 0) b64 += "=";
        const json = atob(b64);
        decoded = JSON.parse(json);
        if (decoded.v !== 1 || !decoded.a || !decoded.t) throw new Error();
      } catch {
        setInviteError("Invalid invite code");
        setRedeeming(false);
        return;
      }

      const serverAddress = decoded.a;

      // Trust the server host for self-signed certs
      try {
        const wsUrl = normalizeServerUrl(serverAddress);
        const serverHost = new URL(wsUrl.replace(/^ws/, "http")).host;
        (window as any).raddir?.trustServerHost(serverHost);
      } catch {}

      // Derive HTTPS base URL from the address
      let apiHost = serverAddress.replace(/^(wss?|https?):\/\//, "").replace(/\/ws\/?$/, "");
      if (!apiHost.includes(":")) apiHost += ":4000";
      const apiBase = "https://" + apiHost;

      // Get or create identity for the public key
      let publicKey: string;
      try {
        const identity = await getOrCreateIdentity();
        publicKey = identity.publicKeyHex;
      } catch {
        setInviteError("Failed to generate identity key");
        setRedeeming(false);
        return;
      }

      const res = await fetch(`${apiBase}/api/invites/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteBlob: code, publicKey }),
      });

      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to redeem invite");
        setRedeeming(false);
        return;
      }

      // Check if server already exists
      const existing = savedServers.find((s) => s.address === serverAddress);
      if (existing) {
        // Update credential on existing server
        useSettingsStore.getState().updateServerCredential(existing.id, data.credential);
        setSelectedId(existing.id);
        setInviteError(null);
        setInviteCode("");
        setShowInviteForm(false);
        setRedeeming(false);
        return;
      } else {
        // Auto-add the server using the store's addServer action
        addServer(serverAddress, serverAddress, undefined, undefined);
        // Find the newly added server and set its credential
        const added = useSettingsStore.getState().savedServers.find(
          (s) => s.address === serverAddress
        );
        if (added) {
          useSettingsStore.getState().updateServerCredential(added.id, data.credential);
          setSelectedId(added.id);
        }
      }

      setInviteCode("");
      setShowInviteForm(false);
    } catch (err: any) {
      setInviteError(err.message || "Failed to redeem invite");
    }
    setRedeeming(false);
  };

  return (
    <div className="flex h-screen bg-surface-950">
      {/* Left sidebar — server list */}
      <div className="w-56 flex flex-col border-r border-surface-800 bg-surface-900">
        <div className="p-3 border-b border-surface-800">
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Servers</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {savedServers.map((server) => (
            <div
              key={server.id}
              onClick={() => setSelectedId(server.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group cursor-pointer",
                selectedId === server.id
                  ? "bg-accent/15 text-accent"
                  : "text-surface-300 hover:bg-surface-800 hover:text-surface-100"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
                selectedId === server.id ? "bg-accent/20" : "bg-surface-700"
              )}>
                <Server className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{server.name}</p>
                <p className="text-[9px] text-surface-500 truncate">{server.address}</p>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!nickname.trim()) return;
                    setServerUrl(server.address);
                    setTimeout(() => connect(), 0);
                  }}
                  disabled={connecting || !nickname.trim()}
                  className="p-1 rounded text-surface-500 hover:text-accent hover:bg-surface-700 transition-all"
                  title="Connect"
                >
                  <Wifi className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeServer(server.id);
                    if (selectedId === server.id) setSelectedId(savedServers.find(s => s.id !== server.id)?.id ?? null);
                  }}
                  className="p-1 rounded text-surface-500 hover:text-red-400 hover:bg-surface-700 transition-all"
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}

          {/* Add server */}
          {showAddForm ? (
            <div className="p-2 bg-surface-800/50 border border-surface-700 rounded-lg space-y-1.5 mt-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                className="w-full px-2 py-1 bg-surface-800 border border-surface-700 rounded text-surface-100 text-[10px] placeholder:text-surface-500 focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="localhost:4000"
                onKeyDown={(e) => e.key === "Enter" && handleAddServer()}
                className="w-full px-2 py-1 bg-surface-800 border border-surface-700 rounded text-surface-100 text-[10px] placeholder:text-surface-500 focus:outline-none focus:border-accent"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password (optional)"
                className="w-full px-2 py-1 bg-surface-800 border border-surface-700 rounded text-surface-100 text-[10px] placeholder:text-surface-500 focus:outline-none focus:border-accent"
              />
              <input
                type="password"
                value={newAdminToken}
                onChange={(e) => setNewAdminToken(e.target.value)}
                placeholder="Admin token (optional)"
                className="w-full px-2 py-1 bg-surface-800 border border-surface-700 rounded text-surface-100 text-[10px] placeholder:text-surface-500 focus:outline-none focus:border-accent"
              />
              <div className="flex gap-1">
                <button onClick={handleAddServer} disabled={!newName.trim() || !newAddress.trim()} className="flex-1 py-1 rounded text-[10px] font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors">Add</button>
                <button onClick={() => { setShowAddForm(false); setNewName(""); setNewAddress(""); setNewPassword(""); setNewAdminToken(""); }} className="px-2 py-1 rounded text-[10px] text-surface-400 hover:bg-surface-700 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setShowAddForm(true); setShowInviteForm(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Server
            </button>
          )}

        </div>

        {/* Bottom bar — invite + settings */}
        <div className="p-2 border-t border-surface-800 space-y-1">
          <button
            onClick={() => { setShowInviteForm(true); setShowAddForm(false); }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <Ticket className="w-3.5 h-3.5" />
            Paste Invite
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </div>

      {/* Right panel — connect */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm px-8 space-y-6">
          <div className="text-center space-y-3">
            <img
              src={logoImg}
              alt="Raddir"
              className="w-20 h-20 mx-auto dark:invert"
            />
            <h1
              className="text-3xl text-surface-50"
              style={{ fontFamily: '"Asimovian", sans-serif' }}
            >
              Raddir
            </h1>
            <p className="text-sm text-surface-400 flex items-center justify-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              End-to-end encrypted voice
            </p>
          </div>

          {selectedServer ? (
            <div className="space-y-4">
              {editingServer ? (
                <div className="p-4 bg-surface-800/40 border border-surface-700 rounded-xl space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-700 flex items-center justify-center mx-auto">
                    <Server className="w-5 h-5 text-surface-400" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-surface-500 uppercase tracking-wider mb-1">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Server name"
                      className="w-full px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-surface-500 uppercase tracking-wider mb-1">Address</label>
                    <input
                      type="text"
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder="host:port"
                      className="w-full px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-surface-500 uppercase tracking-wider mb-1">Password</label>
                    <input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-surface-500 uppercase tracking-wider mb-1">Admin Token</label>
                    <input
                      type="password"
                      value={editAdminToken}
                      onChange={(e) => setEditAdminToken(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        if (editName.trim() && editAddress.trim()) {
                          updateServer(selectedServer.id, editName.trim(), editAddress.trim());
                          updateServerPassword(selectedServer.id, editPassword.trim() || undefined);
                          updateServerAdminToken(selectedServer.id, editAdminToken.trim() || undefined);
                        }
                        setEditingServer(false);
                      }}
                      disabled={!editName.trim() || !editAddress.trim()}
                      className="flex-1 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
                    >Save</button>
                    <button
                      onClick={() => setEditingServer(false)}
                      className="px-3 py-1.5 rounded-md text-xs text-surface-400 hover:bg-surface-700 transition-colors"
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-surface-800/40 border border-surface-700 rounded-xl text-center relative group">
                  <button
                    onClick={() => {
                      setEditName(selectedServer.name);
                      setEditAddress(selectedServer.address);
                      setEditPassword(selectedServer.password ?? "");
                      setEditAdminToken(selectedServer.adminToken ?? "");
                      setEditingServer(true);
                    }}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-surface-600 hover:text-surface-300 hover:bg-surface-700 opacity-0 group-hover:opacity-100 transition-all"
                    title="Edit server"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-surface-700 flex items-center justify-center mx-auto mb-2">
                    <Server className="w-5 h-5 text-surface-400" />
                  </div>
                  <p className="text-sm font-semibold text-surface-200">{selectedServer.name}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">{selectedServer.address}</p>
                  <div className="flex items-center justify-center gap-3 mt-2">
                    {selectedServer.password && (
                      <span className="flex items-center gap-1 text-[9px] text-surface-600">
                        <Lock className="w-2.5 h-2.5" /> Password
                      </span>
                    )}
                    {selectedServer.adminToken && (
                      <span className="flex items-center gap-1 text-[9px] text-surface-600">
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                    {selectedServer.credential && (
                      <span className="flex items-center gap-1 text-[9px] text-surface-600">
                        <Ticket className="w-2.5 h-2.5" /> Invite
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Nickname</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Enter your nickname"
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 text-sm placeholder:text-surface-500 focus:outline-none focus:border-accent"
                />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={handleConnect}
                disabled={connecting || !nickname.trim()}
                className={cn(
                  "w-full py-2.5 rounded-lg text-sm font-medium transition-colors",
                  connecting
                    ? "bg-surface-700 text-surface-400 cursor-wait"
                    : "bg-accent text-white hover:bg-accent-hover"
                )}
              >
                {connecting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Wifi className="w-4 h-4 animate-pulse" /> Connecting...
                  </span>
                ) : "Connect"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-surface-500 text-center">Select a server or add one to get started.</p>
          )}

          <p className="text-xs text-center text-surface-500">
            No account required. Your identity stays on this device.
          </p>
        </div>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Invite code overlay */}
      {showInviteForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="text-center space-y-1">
              <Ticket className="w-8 h-8 text-accent mx-auto" />
              <h2 className="text-lg font-semibold text-surface-100">Paste Invite Code</h2>
              <p className="text-xs text-surface-500">Paste an invite code to join a server. No password needed.</p>
            </div>

            <textarea
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Paste invite code here..."
              rows={3}
              autoFocus
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 text-xs font-mono placeholder:text-surface-500 focus:outline-none focus:border-accent resize-none"
            />

            {inviteError && <p className="text-xs text-red-400 text-center">{inviteError}</p>}

            <div className="flex gap-2">
              <button
                onClick={redeemInvite}
                disabled={!inviteCode.trim() || redeeming}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {redeeming ? "Joining..." : "Join Server"}
              </button>
              <button
                onClick={() => { setShowInviteForm(false); setInviteCode(""); setInviteError(null); }}
                className="px-4 py-2 rounded-lg text-sm text-surface-400 hover:bg-surface-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
