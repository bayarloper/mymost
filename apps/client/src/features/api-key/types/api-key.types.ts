// Ported from Forkmost (AGPL-3.0): https://github.com/Vito0912/forkmost
export interface IApiKey {
  id: string;
  name: string | null;
  creatorId: string;
  workspaceId: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  token?: string;
  creator?: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}
