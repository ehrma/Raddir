# Raddir Permission System

Raddir uses a role-based permission system with channel-tree inheritance, inspired by TeamSpeak.

## Concepts

### Roles

Roles are defined at the **server level**. Each role has:

- **Name**: e.g., Admin, Moderator, Member, Guest
- **Priority**: Higher priority roles take precedence in permission conflicts
- **Permissions**: A set of allow/deny/inherit values
- **Default flag**: New members automatically receive the default role

### Permission Values

Each permission can be set to one of three values:

| Value | Meaning |
|---|---|
| `allow` | Explicitly granted |
| `deny` | Explicitly denied |
| `inherit` | Inherited from parent (resolved to `deny` if no parent grants it) |

### Channel Overrides

Any role's permissions can be overridden on a per-channel basis. This allows fine-grained control like:

- Guests can join the Lobby but not the Officers channel
- Moderators can speak in the Announcements channel but Members cannot

## Permission Keys

| Permission | Description |
|---|---|
| `join` | Join a voice channel |
| `speak` | Transmit audio in a channel |
| `whisper` | Send whisper messages |
| `moveUsers` | Move other users between channels |
| `kick` | Kick users from the server |
| `ban` | Ban users from the server |
| `admin` | Full administrative access (overrides all other permissions) |
| `manageChannels` | Create, edit, delete channels |
| `managePermissions` | Edit channel permission overrides |
| `manageRoles` | Create, edit, delete roles |

## Default Roles

Raddir creates three roles automatically:

### Admin (priority: 100)
All permissions set to `allow`. The `admin` permission grants implicit access to everything.

### Member (priority: 10, default)
- ✅ join, speak, whisper
- ❌ moveUsers, kick, ban, admin, manageChannels, managePermissions, manageRoles

### Guest (priority: 1)
- ✅ join
- ❌ Everything else

## Permission Resolution

Effective permissions are calculated in this order:

1. **Collect user's roles** (sorted by priority, highest first)
2. **Merge server-level permissions**: For each permission key, the first non-`inherit` value from the highest-priority role wins
3. **Check admin**: If `admin` is `allow`, all permissions resolve to `allow`
4. **Apply channel overrides**: Walk the channel tree from root to target channel. For each level, apply overrides from the user's roles (highest priority first). Non-`inherit` values override the server-level result.
5. **Resolve remaining `inherit`**: Any permission still set to `inherit` resolves to `deny`

### Example

```
Server roles:
  Admin:    { speak: allow, kick: allow }
  Member:   { speak: allow, kick: deny }

Channel "Officers" overrides:
  Member:   { speak: deny }

User "Alice" has roles: [Member]

Effective permissions for Alice in "Officers":
  speak: deny   (channel override for Member)
  kick:  deny   (server-level Member permission)
```

## Channel Tree Inheritance

Channels can be nested (parent → child). Permission overrides are inherited down the tree:

```
Server
├── Lobby          (Member: speak=allow)
├── Team Alpha
│   ├── Strategy   (no overrides → inherits from Team Alpha)
│   └── Casual     (Member: speak=allow override)
└── Officers       (Member: join=deny)
```

A child channel inherits its parent's overrides unless it has its own override for that role+permission combination.

## API

### Effective Permissions

The server calculates and returns effective permissions when a user joins:

```json
{
  "type": "joined-server",
  "myPermissions": {
    "join": "allow",
    "speak": "allow",
    "whisper": "allow",
    "moveUsers": "deny",
    "kick": "deny",
    "ban": "deny",
    "admin": "deny",
    "manageChannels": "deny",
    "managePermissions": "deny",
    "manageRoles": "deny"
  }
}
```

Channel-specific permissions are re-evaluated on channel join.
