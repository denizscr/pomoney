import type { Response } from 'express';
import type { WebSocket } from 'ws';

interface SseClient {
  id: string;
  userId: string;
  role: string;
  tenantId: string;
  res: Response;
}

interface WsClient {
  id: string;
  userId: string;
  role: string;
  tenantId: string;
  ws: WebSocket;
}

const sseClients = new Map<string, SseClient>();
const wsClients = new Map<string, WsClient>();

const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'FINANCE_ADMIN',
  'COMPLIANCE_OFFICER',
  'AML_OFFICER',
  'RISK_MANAGER',
  'BRANCH_MANAGER',
  'AUDITOR',
  'CUSTOMER_SUPPORT',
]);

export function registerSseClient(client: SseClient) {
  sseClients.set(client.id, client);
  client.res.write(
    `event: connected\ndata: ${JSON.stringify({ clientId: client.id, transport: 'sse', timestamp: new Date().toISOString() })}\n\n`
  );
}

export function unregisterSseClient(clientId: string) {
  sseClients.delete(clientId);
}

export function registerWsClient(client: WsClient) {
  wsClients.set(client.id, client);
  if (client.ws.readyState === 1) {
    client.ws.send(
      JSON.stringify({
        event: 'connected',
        clientId: client.id,
        transport: 'ws',
        timestamp: new Date().toISOString(),
      })
    );
  }
}

export function unregisterWsClient(clientId: string) {
  wsClients.delete(clientId);
}

export interface SyncPayload {
  type:
    | 'account:updated'
    | 'transaction:created'
    | 'transaction:high_value_alert'
    | 'card:updated'
    | 'profile:updated'
    | 'notification:created'
    | 'ticket:updated'
    | 'support:message'
    | 'pool:updated'
    | 'security:alert'
    | 'compliance:updated'
    | 'pos:updated'
    | 'admin:sync';
  targetUserId?: string;
  tenantId?: string;
  data: Record<string, unknown>;
}

function shouldDeliver(client: { userId: string; role: string; tenantId: string }, payload: SyncPayload): boolean {
  const isAdmin = ADMIN_ROLES.has(client.role);
  const sameTenant = !payload.tenantId || client.tenantId === payload.tenantId;
  const isTargetUser = Boolean(payload.targetUserId && client.userId === payload.targetUserId);
  const isBroadcastAll = !payload.targetUserId;
  return (isTargetUser || isAdmin || isBroadcastAll) && sameTenant;
}

export function broadcastSync(payload: SyncPayload) {
  const envelope = {
    ...payload,
    timestamp: new Date().toISOString(),
  };
  const serialized = JSON.stringify(envelope);

  for (const client of sseClients.values()) {
    if (shouldDeliver(client, payload)) {
      try {
        client.res.write(`event: sync\ndata: ${serialized}\n\n`);
      } catch {
        sseClients.delete(client.id);
      }
    }
  }

  for (const client of wsClients.values()) {
    if (shouldDeliver(client, payload)) {
      try {
        if (client.ws.readyState === 1) {
          client.ws.send(JSON.stringify({ event: 'sync', ...envelope }));
        } else if (client.ws.readyState >= 2) {
          wsClients.delete(client.id);
        }
      } catch {
        wsClients.delete(client.id);
      }
    }
  }
}

export function getConnectedClientCount(): number {
  return sseClients.size + wsClients.size;
}

export function getRealtimeBreakdown(): { sse: number; ws: number; total: number } {
  return {
    sse: sseClients.size,
    ws: wsClients.size,
    total: sseClients.size + wsClients.size,
  };
}
