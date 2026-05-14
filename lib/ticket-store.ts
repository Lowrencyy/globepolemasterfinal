import { cacheGet, cacheSet } from "@/lib/cache";

export type TicketMessage = {
  id: string;
  sender: "user" | "admin";
  text: string;
  timestamp: string;
};

export type Ticket = {
  id: string;
  concern: string;
  status: "Open" | "In Progress" | "Closed";
  createdAt: string;
  messages: TicketMessage[];
};

const TICKETS_CACHE_KEY = "support_tickets_list_v1";

const INITIAL_TICKETS: Ticket[] = [
  {
    id: "TCK-103",
    concern: "Concern: Wrong Span Coordinates mapping",
    status: "In Progress",
    createdAt: "May 13, 2026, 11:30 AM",
    messages: [
      {
        id: "m1",
        sender: "user",
        text: "Concern: Wrong Span Coordinates mapping sa area ng project sitemap. Yung start location po nagshi-shift ng 5 meters.",
        timestamp: "May 13, 11:30 AM",
      },
      {
        id: "m2",
        sender: "admin",
        text: "Acknowledged. Support engineer assigned to recalibrate the GPS threshold offset.",
        timestamp: "May 13, 11:35 AM",
      },
    ],
  },
  {
    id: "TCK-102",
    concern: "Concern: Uploading pole tags offline sync failure",
    status: "Closed",
    createdAt: "May 12, 2026, 09:15 AM",
    messages: [
      {
        id: "m1",
        sender: "user",
        text: "Concern: Uploading pole tags offline sync failure. Naiipon po sa outbox yung mga pictures kapag mahina signal sa site.",
        timestamp: "May 12, 09:15 AM",
      },
      {
        id: "m2",
        sender: "admin",
        text: "Hello team, we have optimized the outbox batch intervals. Paki-refresh po ng inyong network state sa Settings screen.",
        timestamp: "May 12, 10:00 AM",
      },
      {
        id: "m3",
        sender: "user",
        text: "Salamat po, okay na at pumasok na lahat ng pending tasks.",
        timestamp: "May 12, 10:30 AM",
      },
    ],
  },
];

export async function getTickets(): Promise<Ticket[]> {
  const list = await cacheGet<Ticket[]>(TICKETS_CACHE_KEY);
  if (!list || list.length === 0) {
    await cacheSet(TICKETS_CACHE_KEY, INITIAL_TICKETS);
    return INITIAL_TICKETS;
  }
  return list;
}

export async function createTicket(concern: string, description: string): Promise<Ticket> {
  const list = await getTickets();
  const newId = `TCK-${104 + list.length}`;
  const nowStr = new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const newTicket: Ticket = {
    id: newId,
    concern: concern.trim() || "Concern: General Inquiry",
    status: "Open",
    createdAt: nowStr,
    messages: [
      {
        id: "m1",
        sender: "user",
        text: description.trim() || concern.trim(),
        timestamp: nowStr,
      },
    ],
  };

  const updated = [newTicket, ...list];
  await cacheSet(TICKETS_CACHE_KEY, updated);
  return newTicket;
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  const list = await getTickets();
  return list.find((t) => t.id === id) || null;
}

export async function addMessageToTicket(id: string, text: string, sender: "user" | "admin" = "user"): Promise<Ticket | null> {
  const list = await getTickets();
  const ticketIdx = list.findIndex((t) => t.id === id);
  if (ticketIdx === -1) return null;

  const nowStr = new Date().toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const newMsg: TicketMessage = {
    id: `m_${Date.now()}`,
    sender,
    text: text.trim(),
    timestamp: nowStr,
  };

  const currentTicket = list[ticketIdx];
  const updatedTicket: Ticket = {
    ...currentTicket,
    messages: [...currentTicket.messages, newMsg],
  };

  list[ticketIdx] = updatedTicket;
  await cacheSet(TICKETS_CACHE_KEY, list);
  return updatedTicket;
}

export async function updateTicketStatus(id: string, status: Ticket["status"]): Promise<Ticket | null> {
  const list = await getTickets();
  const ticketIdx = list.findIndex((t) => t.id === id);
  if (ticketIdx === -1) return null;

  const updatedTicket: Ticket = {
    ...list[ticketIdx],
    status,
  };

  list[ticketIdx] = updatedTicket;
  await cacheSet(TICKETS_CACHE_KEY, list);
  return updatedTicket;
}
