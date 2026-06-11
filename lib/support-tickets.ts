import api from "@/lib/api";
import { tokenStore } from "@/lib/token";

export type SupportTicketListItem = {
  id: number;
  ticket_number: string;
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  company: string;
  created_at: string;
  updated_at: string;
  submitted_by: number;
  assigned_to?: number | null;
  last_reply_at?: string | null;
  has_unread_for_current?: boolean;
  last_activity_at?: string | null;
};

export type SupportTicketMessage = {
  id: number;
  ticket_id: number;
  sender_id: number;
  message: string;
  created_at: string;
  updated_at: string;
  sender?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    company?: string | null;
    role?: string | null;
  } | null;
  attachments?: Array<{
    id: number;
    file_name: string;
    file_path: string;
    file_url?: string | null;
  }>;
};

export type SupportTicketAttachmentInput = {
  uri: string;
  name: string;
  type?: string;
};

export type SupportTicketDetail = SupportTicketListItem & {
  submittedBy?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    email?: string | null;
  } | null;
  assignedTo?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    email?: string | null;
  } | null;
  attachments?: Array<{
    id: number;
    file_name: string;
    file_path: string;
    file_url?: string | null;
  }>;
  messages: SupportTicketMessage[];
};

export type SupportTicketSession = {
  id: number;
  support_ticket_id: number;
  provider: string;
  room_name: string;
  room_url: string;
  status: "active" | "ended" | "expired";
  started_at?: string | null;
  ended_at?: string | null;
  launch_url?: string | null;
  meta?: Record<string, any> | null;
};

async function getCompanyPrefix(): Promise<string> {
  const user = await tokenStore.getUser();
  const company = String(user?.company ?? "globe").toLowerCase();
  if (company === "skycable" || company === "meralco" || company === "globe") {
    return `/${company}`;
  }
  return "/globe";
}

function normalizeListResponse(data: any): SupportTicketListItem[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function listSupportTickets(): Promise<SupportTicketListItem[]> {
  const prefix = await getCompanyPrefix();
  const { data } = await api.get(`${prefix}/support/tickets`);
  return normalizeListResponse(data);
}

export async function createSupportTicket(input: {
  subject: string;
  description: string;
  priority?: "low" | "medium" | "high" | "urgent";
  attachments?: SupportTicketAttachmentInput[];
}): Promise<SupportTicketListItem> {
  const prefix = await getCompanyPrefix();
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const body = hasAttachments ? new FormData() : {
    subject: input.subject,
    description: input.description,
    priority: input.priority ?? "medium",
  };

  if (hasAttachments && body instanceof FormData) {
    body.append("subject", input.subject);
    body.append("description", input.description);
    body.append("priority", input.priority ?? "medium");
    for (const file of input.attachments ?? []) {
      body.append("attachments[]", {
        uri: file.uri,
        name: file.name,
        type: file.type ?? "image/jpeg",
      } as any);
    }
  }

  const { data } = await api.post(`${prefix}/support/tickets`, body);
  return data;
}

export async function getSupportTicket(id: string | number): Promise<SupportTicketDetail> {
  const prefix = await getCompanyPrefix();
  const { data } = await api.get(`${prefix}/support/tickets/${id}`);
  return {
    ...data,
    attachments: Array.isArray(data?.attachments) ? data.attachments : [],
    messages: Array.isArray(data?.messages) ? data.messages : [],
  };
}

export async function replySupportTicket(
  id: string | number,
  message: string,
  attachments?: SupportTicketAttachmentInput[],
): Promise<SupportTicketMessage> {
  const prefix = await getCompanyPrefix();
  const hasAttachments = (attachments?.length ?? 0) > 0;
  const body = hasAttachments ? new FormData() : { message };

  if (hasAttachments && body instanceof FormData) {
    body.append("message", message);
    for (const file of attachments ?? []) {
      body.append("attachments[]", {
        uri: file.uri,
        name: file.name,
        type: file.type ?? "image/jpeg",
      } as any);
    }
  }

  const { data } = await api.post(`${prefix}/support/tickets/${id}/reply`, body);
  return data;
}

export async function getSupportTicketSession(id: string | number): Promise<SupportTicketSession | null> {
  const prefix = await getCompanyPrefix();
  const { data } = await api.get(`${prefix}/support/tickets/${id}/session`);
  return data?.session ?? null;
}

export async function startOrJoinSupportTicketSession(id: string | number): Promise<SupportTicketSession> {
  const prefix = await getCompanyPrefix();
  const { data } = await api.post(`${prefix}/support/tickets/${id}/session`, {});
  return data.session;
}

export async function endSupportTicketSession(sessionId: string | number): Promise<SupportTicketSession> {
  const prefix = await getCompanyPrefix();
  const { data } = await api.put(`${prefix}/support/ticket-sessions/${sessionId}/end`, {});
  return data.session;
}
