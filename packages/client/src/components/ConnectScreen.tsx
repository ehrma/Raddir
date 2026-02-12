import { useState } from "react";
import { useSettingsStore, type SavedServer } from "../stores/settingsStore";
import { useServerStore } from "../stores/serverStore";
import { Shield, Wifi, Plus, Trash2, Server, Settings, Lock, LockOpen } from "lucide-react";
import { cn } from "../lib/cn";
import { useConnection } from "../hooks/useConnection";
import { SettingsPanel } from "./Settings/SettingsPanel";

export function ConnectScreen() {
  const { nickname, savedServers, setServerUrl, setNickname, addServer, removeServer, updateServerPassword, updateServerAdminToken } = useSettingsStore();
  const { connect, connecting, error } = useConnection();
  const [selectedId, setSelectedId] = useState<string | null>(savedServers[0]?.id ?? null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAdminToken, setNewAdminToken] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [editingAdminToken, setEditingAdminToken] = useState(false);
  const [editAdminToken, setEditAdminToken] = useState("");

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

  return (
    <div className="flex h-screen bg-surface-950">
      {/* Left sidebar — server list */}
      <div className="w-56 flex flex-col border-r border-surface-800 bg-surface-900">
        <div className="p-3 border-b border-surface-800">
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Servers</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {savedServers.map((server) => (
            <button
              key={server.id}
              onClick={() => setSelectedId(server.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group",
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
                {savedServers.length > 1 && (
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
                )}
              </div>
            </button>
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
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Server
            </button>
          )}
        </div>

        {/* Bottom bar — settings */}
        <div className="p-2 border-t border-surface-800">
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
              src="/raddir-shield-logo.png"
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
              <div className="p-4 bg-surface-800/40 border border-surface-700 rounded-xl text-center">
                <div className="w-10 h-10 rounded-xl bg-surface-700 flex items-center justify-center mx-auto mb-2">
                  <Server className="w-5 h-5 text-surface-400" />
                </div>
                <p className="text-sm font-semibold text-surface-200">{selectedServer.name}</p>
                <p className="text-[10px] text-surface-500 mt-0.5">{selectedServer.address}</p>
                {selectedServer.password && !editingPassword && <p className="text-[9px] text-surface-600 mt-0.5">Password protected</p>}
              </div>

              {editingPassword ? (
                <div className="flex gap-2 mt-2">
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Enter password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateServerPassword(selectedServer.id, editPassword.trim() || undefined);
                        setEditingPassword(false);
                        setEditPassword("");
                      }
                    }}
                    className="flex-1 px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      updateServerPassword(selectedServer.id, editPassword.trim() || undefined);
                      setEditingPassword(false);
                      setEditPassword("");
                    }}
                    className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
                  >Save</button>
                  <button
                    onClick={() => { setEditingPassword(false); setEditPassword(""); }}
                    className="px-2.5 py-1.5 rounded-md text-xs text-surface-400 hover:bg-surface-700 transition-colors"
                  >Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingPassword(true); setEditPassword(selectedServer.password ?? ""); }}
                  className="flex items-center gap-1.5 text-[10px] text-surface-500 hover:text-surface-300 transition-colors mt-2"
                >
                  {selectedServer.password ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                  {selectedServer.password ? "Change password" : "Set password"}
                </button>
              )}

              {editingAdminToken ? (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={editAdminToken}
                    onChange={(e) => setEditAdminToken(e.target.value)}
                    placeholder="Admin token"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateServerAdminToken(selectedServer.id, editAdminToken.trim() || undefined);
                        setEditingAdminToken(false);
                        setEditAdminToken("");
                      }
                    }}
                    className="flex-1 px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      updateServerAdminToken(selectedServer.id, editAdminToken.trim() || undefined);
                      setEditingAdminToken(false);
                      setEditAdminToken("");
                    }}
                    className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
                  >Save</button>
                  <button
                    onClick={() => { setEditingAdminToken(false); setEditAdminToken(""); }}
                    className="px-2.5 py-1.5 rounded-md text-xs text-surface-400 hover:bg-surface-700 transition-colors"
                  >Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingAdminToken(true); setEditAdminToken(selectedServer.adminToken ?? ""); }}
                  className="flex items-center gap-1.5 text-[10px] text-surface-500 hover:text-surface-300 transition-colors"
                >
                  <Shield className="w-3 h-3" />
                  {selectedServer.adminToken ? "Change admin token" : "Set admin token"}
                </button>
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
    </div>
  );
}
